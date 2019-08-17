#!/usr/bin/env node
import "source-map-support/register";
import cdk = require("@aws-cdk/core");
import { CfAlbAsgStack } from "../lib/cf-alb-asg-stack";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

const app = new cdk.App();

new CfAlbAsgStack(app, "CfAlbAsgStack", {
  env: env
});
