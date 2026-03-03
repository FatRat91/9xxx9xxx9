import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as config from 'aws-cdk-lib/aws-config';
import * as securityhub from 'aws-cdk-lib/aws-securityhub';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';

export interface IamTokaStackProps extends cdk.StackProps {
  // IAMロール: assumedBy に使う AWSReservedSSO ロール ARN
  idcSwitchRoleArn?: string;
  // IAMロール: Trust policy の StringLike aws:userid 条件
  allowedIdcUserIdPattern?: string;
  // Budgets: budgetLimit (USD)
  budgetLimitUsd?: number;
  // Budgets: notifications (メール通知先)
  budgetNotificationEmail?: string;
  environment?: 'prod' | 'test' | 'cicd';
}

export class IamTokaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: IamTokaStackProps) {
    super(scope, id, props);

    const envName = props?.environment ?? 'test';
    const idcSwitchRoleArn =
      props?.idcSwitchRoleArn ??
      `arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/AWSReservedSSO_ExamplePermissionSet_0123456789abcdef`;
    const allowedIdcUserIdPattern = props?.allowedIdcUserIdPattern ?? '*:user@example.go.jp';
    const budgetLimitUsd = props?.budgetLimitUsd ?? 200;
    const budgetNotificationEmail = props?.budgetNotificationEmail ?? 'security-ops@example.go.jp';

    // AGENTS.md要件: タグの基本セット
    cdk.Tags.of(this).add('SystemName', 'gabagaba21');
    cdk.Tags.of(this).add('Environment', envName);
    cdk.Tags.of(this).add('Owner', 'platform-team');
    cdk.Tags.of(this).add('CostTag', 'gabagaba21-security');

    // ---------------------------------------------------------------------
    // 1) IAMロール
    // ---------------------------------------------------------------------
    const operationRole = new iam.Role(this, 'OperationRole', {
      roleName: `gabagaba21-${envName}-operation-role`,
      // required: assumedBy (Principal)
      assumedBy: new iam.ArnPrincipal(idcSwitchRoleArn).withConditions({
        // required: conditions (StringLike + aws:userid)
        StringLike: {
          'aws:userid': allowedIdcUserIdPattern,
        },
      }),
      // required: managedPolicies
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
      description: 'Operation role assumed from IAM Identity Center federated role',
    });

    operationRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadonlyForDailyOps',
        actions: [
          'ec2:DescribeInstances',
          'ec2:DescribeSecurityGroups',
          'rds:DescribeDBInstances',
          'cloudwatch:GetMetricData',
          'cloudwatch:ListDashboards',
          'logs:DescribeLogGroups',
        ],
        resources: ['*'],
      }),
    );

    cdk.Tags.of(operationRole).add('Name', `gabagaba21-${envName}-iam-operation-role`);

    // ---------------------------------------------------------------------
    // 2) CloudTrail
    // ---------------------------------------------------------------------
    const trailKey = new kms.Key(this, 'CloudTrailKey', {
      enableKeyRotation: true,
      alias: `alias/gabagaba21/${envName}/cloudtrail`,
    });

    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: trailKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      bucketKeyEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const trail = new cloudtrail.Trail(this, 'CloudTrail', {
      // required: bucket
      bucket: trailBucket,
      // required: kmsKey / encryptionKey
      encryptionKey: trailKey,
      // required: enableLogFileValidation (L2では enableFileValidation)
      enableFileValidation: true,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
    });
    trail.logAllLambdaDataEvents();

    // ---------------------------------------------------------------------
    // 3) AWS Config
    // ---------------------------------------------------------------------
    const configRole = new iam.Role(this, 'ConfigRecorderRole', {
      assumedBy: new iam.ServicePrincipal('config.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWS_ConfigRole'),
      ],
    });

    const configBucket = new s3.Bucket(this, 'ConfigBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: trailKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const configRecorder = new config.CfnConfigurationRecorder(this, 'ConfigRecorder', {
      roleArn: configRole.roleArn,
      recordingGroup: {
        allSupported: true,
        includeGlobalResourceTypes: true,
      },
    });

    const configDeliveryChannel = new config.CfnDeliveryChannel(this, 'ConfigDeliveryChannel', {
      s3BucketName: configBucket.bucketName,
      s3KmsKeyArn: trailKey.keyArn,
    });

    const cfgRuleTrailValidation = new config.ManagedRule(this, 'ConfigRuleCloudTrailLogValidation', {
      // required: ConfigRule
      identifier: config.ManagedRuleIdentifiers.CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED,
    });
    cfgRuleTrailValidation.node.addDependency(configRecorder);
    cfgRuleTrailValidation.node.addDependency(configDeliveryChannel);

    const cfgRuleS3Encryption = new config.ManagedRule(this, 'ConfigRuleS3Encryption', {
      identifier: config.ManagedRuleIdentifiers.S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED,
    });
    cfgRuleS3Encryption.node.addDependency(configRecorder);
    cfgRuleS3Encryption.node.addDependency(configDeliveryChannel);

    const conformancePack = new config.CfnConformancePack(this, 'ConfigConformancePack', {
      // required: compliancePack
      conformancePackName: `gabagaba21-${envName}-baseline-pack`,
      templateBody: [
        'Resources:',
        '  CloudTrailEnabledRule:',
        '    Type: AWS::Config::ConfigRule',
        '    Properties:',
        '      ConfigRuleName: cloudtrail-enabled',
        '      Source:',
        '        Owner: AWS',
        '        SourceIdentifier: CLOUD_TRAIL_ENABLED',
      ].join('\n'),
    });
    conformancePack.addDependency(configRecorder);
    conformancePack.addDependency(configDeliveryChannel);

    // ---------------------------------------------------------------------
    // 4) Security Hub
    // ---------------------------------------------------------------------
    const hub = new securityhub.CfnHub(this, 'SecurityHubHub', {
      enableDefaultStandards: false,
      autoEnableControls: true,
      controlFindingGenerator: 'SECURITY_CONTROL',
    });

    const afsbp = new securityhub.CfnStandard(this, 'SecurityHubStandardAfsbp', {
      standardsArn: `arn:${cdk.Aws.PARTITION}:securityhub:${cdk.Aws.REGION}::standards/aws-foundational-security-best-practices/v/1.0.0`,
    });
    afsbp.node.addDependency(hub);

    const cis = new securityhub.CfnStandard(this, 'SecurityHubStandardCis', {
      standardsArn: `arn:${cdk.Aws.PARTITION}:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0`,
    });
    cis.node.addDependency(hub);

    // ---------------------------------------------------------------------
    // 5) Amazon GuardDuty
    // ---------------------------------------------------------------------
    const detector = new guardduty.CfnDetector(this, 'GuardDutyDetector', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
    });

    const malwareTargetBucket = new s3.Bucket(this, 'GuardDutyMalwareTargetBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: trailKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const malwareRole = new iam.Role(this, 'GuardDutyMalwareRole', {
      assumedBy: new iam.ServicePrincipal('malware-protection-plan.guardduty.amazonaws.com'),
    });

    malwareRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [malwareTargetBucket.bucketArn],
      }),
    );
    malwareRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObjectTagging'],
        resources: [`${malwareTargetBucket.bucketArn}/*`],
      }),
    );

    const malwarePlan = new guardduty.CfnMalwareProtectionPlan(this, 'GuardDutyMalwareProtectionPlan', {
      // required (実務観点): MalwareProtection の対象リソース指定
      protectedResource: {
        s3Bucket: {
          bucketName: malwareTargetBucket.bucketName,
          objectPrefixes: ['uploads/'],
        },
      },
      role: malwareRole.roleArn,
      actions: {
        tagging: {
          status: 'ENABLED',
        },
      },
    });
    malwarePlan.node.addDependency(detector);

    // ---------------------------------------------------------------------
    // 6) AWS Budgets
    // ---------------------------------------------------------------------
    const budgetTopic = new sns.Topic(this, 'BudgetNotificationTopic', {
      masterKey: trailKey,
      topicName: `gabagaba21-${envName}-budget-topic`,
    });

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: `gabagaba21-${envName}-monthly-budget`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        // required: budgetLimit
        budgetLimit: {
          amount: budgetLimitUsd,
          unit: 'USD',
        },
      },
      // required: notifications (閾値)
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'EMAIL',
              address: budgetNotificationEmail,
            },
            {
              subscriptionType: 'SNS',
              address: budgetTopic.topicArn,
            },
          ],
        },
      ],
    });

    new cdk.CfnOutput(this, 'OperationRoleArn', {
      value: operationRole.roleArn,
    });
  }
}

