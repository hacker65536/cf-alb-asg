import cdk = require("@aws-cdk/core");
import {
  Vpc,
  SecurityGroup,
  Port,
  CfnLaunchTemplate,
  CfnEC2Fleet
} from "@aws-cdk/aws-ec2";
import ec2 = require("@aws-cdk/aws-ec2");
import { CfnListenerRule } from "@aws-cdk/aws-elasticloadbalancingv2";
import elbv2 = require("@aws-cdk/aws-elasticloadbalancingv2");
import s3 = require("@aws-cdk/aws-s3");
import as = require("@aws-cdk/aws-autoscaling");
import iam = require("@aws-cdk/aws-iam");
import acm = require("@aws-cdk/aws-certificatemanager");
import r53 = require("@aws-cdk/aws-route53");
import r53t = require("@aws-cdk/aws-route53-targets");
import cf = require("@aws-cdk/aws-cloudfront");

export class CfAlbAsgStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // Interfaces
    interface IAllowips {
      ip: string;
      description?: string;
    }

    // VARs
    // instancetype
    var instancetype = ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE2,
      ec2.InstanceSize.MEDIUM
    );
    // ami
    const amiamzn2 = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
    });

    // userdata
    var userdatacommands: string[] = [
      "sudo amazon-linux-extras install nginx1.12",
      "sudo systemctl start nginx"
    ];

    // domain
    const domain = this.node.tryGetContext("mydomain");
    const hostname = this.node.tryGetContext("myhost");

    // allowips
    const allowips = this.node.tryGetContext("allowips");

    // keypair
    const keypair = this.node.tryGetContext("keypair");

    // VPC
    const vpc = new Vpc(this, "vpc", {
      maxAzs: 2
    });

    // default sg
    const defsg = SecurityGroup.fromSecurityGroupId(
      this,
      "defaultsg",
      vpc.vpcDefaultSecurityGroup
    );

    // vpc uid
    const uid = vpc.node.uniqueId;

    // ACM
    const hz = r53.HostedZone.fromLookup(this, "mydnshz", {
      domainName: domain,
      privateZone: false
    });

    // cert (this will create lambda function for validation)
    const cert = new acm.DnsValidatedCertificate(this, "mycert", {
      domainName: `cfalbasg.${domain}`,
      hostedZone: hz
    });

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "alb", {
      vpc,
      internetFacing: true
    });

    // logging
    const alblogs3 = new s3.Bucket(this, "alblog");
    alb.logAccessLogs(alblogs3, "alblog");

    // listener
    const listener = alb.addListener("listener", {
      certificateArns: [cert.certificateArn],
      port: 443,
      open: true
      //open: false
    });
    listener.addFixedResponse("rule0", {
      statusCode: "403",
      contentType: elbv2.ContentType.TEXT_PLAIN,
      messageBody: "wrong route"
    });

    // add targetgroup
    /*
    const albtg1 = listener.addTargets("albtg1", {
      port: 80
    });
    */
    const albtg1 = new elbv2.ApplicationTargetGroup(this, "albtg1", {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP
    });

    // listener rule
    const albrule = new CfnListenerRule(this, "albrule", {
      actions: [
        {
          type: "forward",
          targetGroupArn: albtg1.targetGroupArn
        }
      ],
      conditions: [
        {
          field: "http-header",
          httpHeaderConfig: {
            httpHeaderName: "cf-origin-custom-header",
            values: [uid]
          }
        }
      ],
      listenerArn: listener.listenerArn,
      priority: 2
    });

    // ASG
    // userdata
    const userdata = ec2.UserData.forLinux({
      shebang: "#!/bin/env bash"
    });

    userdata.addCommands(...userdatacommands);

    // asg
    const asg1 = new as.AutoScalingGroup(this, "asg", {
      instanceType: instancetype,
      machineImage: amiamzn2,
      keyName: keypair,
      vpc: vpc,
      userData: userdata
    });

    // add policy to role
    const policies = iam.ManagedPolicy;
    var awspolicis = [
      "service-role/AmazonEC2RoleforSSM"
      //"AmazonS3ReadOnlyAccess"
    ];
    awspolicis.forEach(v => {
      asg1.role.addManagedPolicy(policies.fromAwsManagedPolicyName(v));
    });

    // add default sg
    asg1.addSecurityGroup(defsg);

    // add asg to alb target
    albtg1.addTarget(asg1);

    alb.connections.allowTo(asg1, Port.tcp(80));
    asg1.connections.allowFrom(alb, Port.tcp(80));

    // CLOUDFRONT
    const s3img = new s3.Bucket(this, "s3img");
    const cflog = new s3.Bucket(this, "cflog");
    const oai = new cf.CfnCloudFrontOriginAccessIdentity(this, "OAI", {
      cloudFrontOriginAccessIdentityConfig: {
        comment: `access-identity-${hostname}`
      }
    });
    const cfwd = new cf.CloudFrontWebDistribution(this, "cf", {
      originConfigs: [
        {
          customOriginSource: {
            domainName: alb.loadBalancerDnsName,
            allowedOriginSSLVersions: [cf.OriginSslPolicy.TLS_V1_1],
            originProtocolPolicy: cf.OriginProtocolPolicy.MATCH_VIEWER
          },
          behaviors: [
            {
              forwardedValues: {
                queryString: true,
                cookies: { forward: "all" }, //[all, whitelist, none]
                headers: ["*"]
              },
              isDefaultBehavior: true
            }
          ],
          originHeaders: {
            "cf-origin-custom-header": uid
          }
        },
        {
          s3OriginSource: {
            originAccessIdentityId: oai.ref,
            s3BucketSource: s3img
          },
          behaviors: [{ pathPattern: "/images/*" }]
        }
      ],
      aliasConfiguration: {
        acmCertRef: cert.certificateArn,
        names: [`${hostname}.${domain}`],
        securityPolicy: cf.SecurityPolicyProtocol.TLS_V1_1_2016
      },
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      loggingConfig: {
        bucket: cflog,
        prefix: "cflog"
      },
      defaultRootObject: "",
      comment: this.stackName
    });

    // alias
    const cftarget = new r53t.CloudFrontTarget(cfwd);
    const host = new r53.RecordSet(this, "host", {
      recordType: r53.RecordType.A,
      target: r53.RecordTarget.fromAlias(cftarget),
      zone: hz,
      recordName: hostname //explicitly
    });

    // security group for bastion
    const bastionsg = new ec2.SecurityGroup(this, "bastionsg", {
      vpc,
      securityGroupName: "bastionsg"
    });

    // add ingress to bastion sg
    allowips.forEach((v: IAllowips) => {
      bastionsg.addIngressRule(
        ec2.Peer.ipv4(v.ip + "/32"),
        Port.tcp(22),
        v.description
      );
    });

    // launch template
    const ltemp = new CfnLaunchTemplate(this, "ltemp", {
      //launchTemplateName: "cftemp",
      launchTemplateData: {
        imageId: amiamzn2.getImage(this).imageId,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.BURSTABLE2,
          ec2.InstanceSize.MICRO
        ).toString(),
        keyName: keypair,
        securityGroupIds: [
          bastionsg.securityGroupId,
          vpc.vpcDefaultSecurityGroup
        ],
        tagSpecifications: [
          {
            resourceType: "instance",
            tags: [
              {
                key: "Name",
                value: "cfalbasg-bastion"
              }
            ]
          }
        ]
      }
    });

    // ec2 instance for bastion
    const ec2fleet = new CfnEC2Fleet(this, "bastion", {
      launchTemplateConfigs: [
        {
          launchTemplateSpecification: {
            // launchTemplateName: ltemp.logicalId,
            launchTemplateId: ltemp.ref,
            version: ltemp.attrLatestVersionNumber
          },
          overrides: [
            {
              availabilityZone: vpc.publicSubnets[0].availabilityZone,
              subnetId: vpc.publicSubnets[0].subnetId
            }
          ]
        }
      ],
      targetCapacitySpecification: {
        totalTargetCapacity: 1,
        defaultTargetCapacityType: "spot"
      }
    });

    // TODO
    console.log(this.node.uniqueId);
    new cdk.CfnOutput(this, "uid", {
      value: this.node.uniqueId
    });
    new cdk.CfnOutput(this, "uid2", {
      value: uid
    });
  }
}
