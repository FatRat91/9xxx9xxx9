import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class GcFargateApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'ApiVpc', {
            ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
            maxAzs: 2,
            natGateways: 1,
            restrictDefaultSecurityGroup: true,
            subnetConfiguration: [
                {
                    name: 'public-ingress',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'private-app',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'private-db',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
        });

        const apiKey = new kms.Key(this, 'ApiKey', {
            alias: 'alias/gc/fargate/api',
            description: 'KMS key for ECS API stack resources',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        const apiBucket = new s3.Bucket(this, 'ApiBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: apiKey,
            enforceSSL: true,
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            lifecycleRules: [
                {
                    id: 'expire-temp-objects',
                    prefix: 'temp/',
                    expiration: cdk.Duration.days(30),
                    enabled: true,
                },
            ],
        });

        const cluster = new ecs.Cluster(this, 'ApiCluster', {
            vpc,
            clusterName: 'gc-fargate-api-cluster',
            enableFargateCapacityProviders: true,
            containerInsightsV2: ecs.ContainerInsights.ENABLED,
        });

        const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
            vpc,
            allowAllOutbound: false,
            description: 'Security group for public ALB',
        });

        const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
            vpc,
            allowAllOutbound: false,
            description: 'Security group for ECS Fargate service',
        });

        const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
            vpc,
            allowAllOutbound: false,
            description: 'Security group for Aurora PostgreSQL cluster',
        });

        albSg.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(80),
            'Allow HTTP from internet for learning',
        );
        albSg.addEgressRule(
            serviceSg,
            ec2.Port.tcp(8080),
            'Allow traffic from ALB to ECS service',
        );

        serviceSg.addIngressRule(
            albSg,
            ec2.Port.tcp(8080),
            'Allow ALB to Fargate tasks',
        );
        serviceSg.addEgressRule(
            dbSg,
            ec2.Port.tcp(5432),
            'Allow service to Aurora PostgreSQL',
        );
        serviceSg.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Allow HTTPS outbound via NAT for learning',
        );

        dbSg.addIngressRule(
            serviceSg,
            ec2.Port.tcp(5432),
            'Allow ECS service to DB',
        );

        const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Execution role for ECS tasks',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    'service-role/AmazonECSTaskExecutionRolePolicy',
                ),
            ],
        });

        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Application task role for ECS tasks',
        });

        const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
            secretName: 'gc/fargate/api/db-master',
            encryptionKey: apiKey,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: 'appadmin' }),
                generateStringKey: 'password',
                excludePunctuation: true,
                includeSpace: false,
                passwordLength: 24,
            },
        });

        apiBucket.grantReadWrite(taskRole);
        dbSecret.grantRead(taskRole);
        apiKey.grantEncryptDecrypt(taskRole);

        dbSecret.grantRead(taskExecutionRole);
        apiKey.grantDecrypt(taskExecutionRole);

        const dbCluster = new rds.DatabaseCluster(this, 'ApiDbCluster', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_16_4,
            }),
            credentials: rds.Credentials.fromSecret(dbSecret),
            defaultDatabaseName: 'appdb',
            writer: rds.ClusterInstance.provisioned('writer', {
                instanceType: ec2.InstanceType.of(
                    ec2.InstanceClass.T4G,
                    ec2.InstanceSize.MEDIUM,
                ),
                publiclyAccessible: false,
            }),
            readers: [],
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            securityGroups: [dbSg],
            storageEncrypted: true,
            storageEncryptionKey: apiKey,
            backup: {
                retention: cdk.Duration.days(7),
            },
            deletionProtection: false,
            removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
        });

        const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
            logGroupName: '/gc/fargate/api/app',
            retention: logs.RetentionDays.ONE_MONTH,
            encryptionKey: apiKey,
            logGroupClass: logs.LogGroupClass.STANDARD,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
            cpu: 512,
            memoryLimitMiB: 1024,
            executionRole: taskExecutionRole,
            taskRole,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
        });

        taskDefinition.addContainer('ApiContainer', {
            containerName: 'api',
            image: ecs.ContainerImage.fromRegistry(
                'public.ecr.aws/docker/library/nginx:stable-alpine',
            ),
            command: [
                'sh',
                '-c',
                "sed -i 's/listen       80;/listen 8080;/g' /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'",
            ],
            cpu: 256,
            memoryLimitMiB: 512,
            logging: ecs.LogDrivers.awsLogs({
                logGroup: apiLogGroup,
                streamPrefix: 'api',
            }),
            environment: {
                APP_ENV: 'dev',
                APP_PORT: '8080',
                DB_HOST: dbCluster.clusterEndpoint.hostname,
                DB_PORT: '5432',
                DB_NAME: 'appdb',
                S3_BUCKET_NAME: apiBucket.bucketName,
            },
            secrets: {
                DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
                DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
            },
            portMappings: [
                {
                    containerPort: 8080,
                    protocol: ecs.Protocol.TCP,
                },
            ],
            healthCheck: {
                command: ['CMD-SHELL', 'wget -qO- http://localhost:8080/ || exit 1'],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                retries: 3,
                startPeriod: cdk.Duration.seconds(10),
            },
        });

        const apiService = new ecs.FargateService(this, 'ApiService', {
            cluster,
            taskDefinition,
            serviceName: 'gc-fargate-api-service',
            desiredCount: 2,
            assignPublicIp: false,
            securityGroups: [serviceSg],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            enableExecuteCommand: true,
            healthCheckGracePeriod: cdk.Duration.seconds(60),
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
        });

        const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            internetFacing: true,
            securityGroup: albSg,
            deletionProtection: false,
            dropInvalidHeaderFields: true,
            idleTimeout: cdk.Duration.seconds(60),
        });

        const listener = alb.addListener('HttpListener', {
            port: 80,
            open: false,
        });

        const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
            vpc,
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 8080,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                enabled: true,
                path: '/',
                healthyHttpCodes: '200-399',
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 2,
            },
        });

        listener.addTargetGroups('DefaultTg', {
            targetGroups: [apiTargetGroup],
        });
        apiService.attachToApplicationTargetGroup(apiTargetGroup);
        listener.connections.allowDefaultPortFrom(
            ec2.Peer.anyIpv4(),
            'Allow HTTP from internet',
        );

        const scalableTarget = apiService.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 4,
        });

        scalableTarget.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 60,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        new cloudwatch.Alarm(this, 'ServiceHighCpuAlarm', {
            metric: apiService.metricCpuUtilization({
                period: cdk.Duration.minutes(5),
                statistic: 'Average',
            }),
            threshold: 80,
            evaluationPeriods: 2,
            datapointsToAlarm: 2,
            comparisonOperator:
                cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
            metric: alb.metricHttpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator:
                cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        const albWebAcl = new wafv2.CfnWebACL(this, 'AlbWebAcl', {
            defaultAction: { allow: {} },
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'gc-fargate-api-web-acl',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'AWSManagedCommonRuleSet',
                    priority: 0,
                    overrideAction: { none: {} },
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesCommonRuleSet',
                        },
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'gc-fargate-api-common-rules',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });

        new wafv2.CfnWebACLAssociation(this, 'AlbWebAclAssociation', {
            resourceArn: alb.loadBalancerArn,
            webAclArn: albWebAcl.attrArn,
        });

        new cdk.CfnOutput(this, 'AlbDnsName', {
            value: alb.loadBalancerDnsName,
        });

        new cdk.CfnOutput(this, 'EcsClusterName', {
            value: cluster.clusterName,
        });

        new cdk.CfnOutput(this, 'EcsServiceName', {
            value: apiService.serviceName,
        });

        new cdk.CfnOutput(this, 'TaskDefinitionFamily', {
            value: taskDefinition.family,
        });

        new cdk.CfnOutput(this, 'AuroraEndpoint', {
            value: dbCluster.clusterEndpoint.hostname,
        });

        new cdk.CfnOutput(this, 'ApiBucketName', {
            value: apiBucket.bucketName,
        });

        new cdk.CfnOutput(this, 'ApiLogGroupName', {
            value: apiLogGroup.logGroupName,
        });

        new cdk.CfnOutput(this, 'AlbWebAclArn', {
            value: albWebAcl.attrArn,
        });

    }
}
