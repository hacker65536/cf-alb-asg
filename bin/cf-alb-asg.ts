#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { CfAlbAsgStack } from '../lib/cf-alb-asg-stack';

const app = new cdk.App();
new CfAlbAsgStack(app, 'CfAlbAsgStack');
