import cdk = require("@aws-cdk/core");
import { Vpc } from "@aws-cdk/aws-ec2";
import ec2 = require("@aws-cdk/aws-ec2");
import elbv2 = require("@aws-cdk/aws-elasticloadbalancingv2");
import s3 = require("@aws-cdk/aws-s3");
import as = require("@aws-cdk/aws-autoscaling");

export class CfAlbAsgStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    //variables
    var instancetype = ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE2,
      ec2.InstanceSize.MEDIUM
    );

    const amiamzn2 = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
    });

    var userdatacommands: string[] = [
      "sudo amazon-linux-extras install nginx1.12",
      "sudo systemctl start nginx"
    ];

    // VPC
    const vpc = new Vpc(this, "vpc", {
      maxAzs: 2
    });

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "alb", {
      vpc,
      internetFacing: true
    });

    // ALB logging
    const alblogs3 = new s3.Bucket(this, "alblog");
    alb.logAccessLogs(alblogs3, "alblog");

    // userdata
    const userdata = ec2.UserData.forLinux({
      shebang: "#!/bin/env bash"
    });

    userdata.addCommands(...userdatacommands);

    // ASG
    const asg = new as.AutoScalingGroup(this, "asg", {
      instanceType: instancetype,
      machineImage: amiamzn2,
      vpc: vpc,
      userData: userdata
    });
  }
}
