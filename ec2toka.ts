import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface Ec2TokaStackProps extends cdk.StackProps {
  environment?: 'prod' | 'test' | 'cicd';
  owner?: string;
  // IAM Identity Center から払い出される AWSReservedSSO ロールARN
  idcSwitchRoleArn?: string;
  // 信頼ポリシー Condition (StringLike: aws:userid)
  allowedIdcUserIdPattern?: string;
}

export class Ec2TokaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: Ec2TokaStackProps) {
    super(scope, id, props);

    const envName = props?.environment ?? 'test';
    const owner = props?.owner ?? 'platform-team';

    const idcSwitchRoleArn =
      props?.idcSwitchRoleArn ??
      `arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/AWSReservedSSO_ExamplePermissionSet_0123456789abcdef`;

    const allowedIdcUserIdPattern = props?.allowedIdcUserIdPattern ?? '*:user@example.go.jp';

    // AGENTS.md を意識した基本タグ
    cdk.Tags.of(this).add('SystemName', 'gabagaba21');
    cdk.Tags.of(this).add('Environment', envName);
    cdk.Tags.of(this).add('Owner', owner);
    cdk.Tags.of(this).add('CostTag', 'gabagaba21-ec2');

    // ---------------------------------------------------------------------
    // 1) KMS: EBS暗号化用CMK
    // ---------------------------------------------------------------------
    const ebsCmk = new kms.Key(this, 'EbsCmk', {
      // 重要Props: alias
      alias: 'alias/ebs-key',
      // 重要Props: enableKeyRotation
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CloudWatch Logs 暗号化用CMK
    const logsCmk = new kms.Key(this, 'LogsCmk', {
      alias: 'alias/cloudwatch-logs-key',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------------------------------------------------------------------
    // 2) IAM (IdC -> SwitchRole)
    // ---------------------------------------------------------------------
    const operatorRole = new iam.Role(this, 'OperatorRole', {
      roleName: `gabagaba21-${envName}-operator-role`,
      // 重要Props: assumedBy (IdCスイッチロールのみ信頼)
      assumedBy: new iam.ArnPrincipal(idcSwitchRoleArn).withConditions({
        // 重要Props: conditions (aws:userid で絞り込み)
        StringLike: {
          'aws:userid': allowedIdcUserIdPattern,
        },
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess'),
      ],
      description: 'Operator role for switch-role from IAM Identity Center',
    });

    // ---------------------------------------------------------------------
    // 3) VPC (業務系は private subnet 利用)
    // ---------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'AppVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/20'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private-egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // ---------------------------------------------------------------------
    // 4) SSM運用用 IAMロール (EC2/ASG インスタンス共通)
    // ---------------------------------------------------------------------
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      // 重要Props: managedPolicies (AmazonSSMManagedInstanceCore)
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
      description: 'Instance role for SSM-based operations without bastion',
    });

    // 参考: SSM SessionManager 経由での運用前提。SSH/RDP 直接ログインは最小化する。

    // ---------------------------------------------------------------------
    // 5) CloudWatch Logs
    // ---------------------------------------------------------------------
    const appLogGroup = new logs.LogGroup(this, 'AppLogGroup', {
      logGroupName: `/gabagaba21/${envName}/ec2-app`,
      // 重要Props: retention
      retention: logs.RetentionDays.ONE_YEAR,
      // 重要Props: encryptionKey
      encryptionKey: logsCmk,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------------------------------------------------------------------
    // 6) EC2 (単体サンプル)
    // ---------------------------------------------------------------------
    const webSg = new ec2.SecurityGroup(this, 'WebSg', {
      vpc,
      allowAllOutbound: true,
      description: 'No inbound by default; operate via SSM',
    });

    const ec2Instance = new ec2.Instance(this, 'SampleInstance', {
      // 重要Props: vpc
      vpc,
      // private subnet を明示
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      // 重要Props: role
      role: instanceRole,
      securityGroup: webSg,
      // 重要Props: machineImage (latestWindows)
      machineImage: ec2.MachineImage.latestWindows(ec2.WindowsVersion.WINDOWS_SERVER_2025_JAPANESE_FULL_BASE),
      // 重要Props: blockDevices (CMK暗号化)
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(80, {
            // 重要Props (EBS): encrypted
            encrypted: true,
            // 重要Props (EBS): volumeEncryptionKey 相当
            kmsKey: ebsCmk,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    // ---------------------------------------------------------------------
    // 7) Auto Scaling Group
    // ---------------------------------------------------------------------
    const asg = new autoscaling.AutoScalingGroup(this, 'AppAsg', {
      // 重要Props: vpc
      vpc,
      // private subnet を明示
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      // 重要Props: role
      role: instanceRole,
      // 重要Props: machineImage (latestWindows)
      machineImage: ec2.MachineImage.latestWindows(ec2.WindowsVersion.WINDOWS_SERVER_2025_JAPANESE_FULL_BASE),
      minCapacity: 1,
      desiredCapacity: 1,
      maxCapacity: 2,
      // 重要Props: blockDevices (CMK暗号化)
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(80, {
            encrypted: true,
            // volumeEncryptionKey 相当
            kmsKey: ebsCmk,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      // 重要Props: instanceMonitoring
      instanceMonitoring: autoscaling.Monitoring.DETAILED,
    });
    asg.addSecurityGroup(webSg);

    // Nameタグ（主要リソース）
    cdk.Tags.of(vpc).add('Name', `gabagaba21-${envName}-vpc`);
    cdk.Tags.of(ec2Instance).add('Name', `gabagaba21-${envName}-ec2-sample`);
    cdk.Tags.of(asg).add('Name', `gabagaba21-${envName}-asg`);
    cdk.Tags.of(appLogGroup).add('Name', `gabagaba21-${envName}-logs`);
    cdk.Tags.of(operatorRole).add('Name', `gabagaba21-${envName}-iam-operator-role`);

    new cdk.CfnOutput(this, 'InstanceRoleArn', { value: instanceRole.roleArn });
    new cdk.CfnOutput(this, 'OperatorRoleArn', { value: operatorRole.roleArn });
    new cdk.CfnOutput(this, 'LogGroupName', { value: appLogGroup.logGroupName });
  }
}

