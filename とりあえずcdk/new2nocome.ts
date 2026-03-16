import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class GcBaselineSecurityStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'BaseVpc', {
            ipAddresses: ec2.IpAddresses.cidr('10.30.0.0/16'),
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
                    name: 'private-isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
        });

        const baselineKey = new kms.Key(this, 'BaselineKey', {
            alias: 'alias/gc/baseline/security',
            description:
                'KMS key for baseline security resources such as S3 and CloudWatch Logs',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pendingWindow: cdk.Duration.days(30),
        });

        const baselineBucket = new s3.Bucket(this, 'BaselineBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: baselineKey,
            enforceSSL: true,
            versioned: true,
            serverAccessLogsPrefix: 'access-logs/',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            lifecycleRules: [
                {
                    id: 'expire-temp-artifacts',
                    prefix: 'artifacts/temp/',
                    expiration: cdk.Duration.days(30),
                    enabled: true,
                },
            ],
        });

        const baselineLogGroup = new logs.LogGroup(this, 'BaselineLogGroup', {
            logGroupName: '/gc/baseline/security/main',
            retention: logs.RetentionDays.THREE_MONTHS,
            encryptionKey: baselineKey,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            logGroupClass: logs.LogGroupClass.STANDARD,
        });

        const endpointSg = new ec2.SecurityGroup(this, 'EndpointSg', {
            vpc,
            allowAllOutbound: false,
            description: 'Security group for interface VPC endpoints',
        });

        endpointSg.addIngressRule(
            ec2.Peer.ipv4('10.30.0.0/16'),
            ec2.Port.tcp(443),
            'Allow HTTPS from inside VPC to interface endpoints',
        );

        const sampleWorkloadSg = new ec2.SecurityGroup(this, 'SampleWorkloadSg', {
            vpc,
            allowAllOutbound: false,
            description: 'Sample workload SG to demonstrate endpoint access patterns',
        });

        sampleWorkloadSg.addEgressRule(
            endpointSg,
            ec2.Port.tcp(443),
            'Allow HTTPS to interface endpoints only',
        );

        sampleWorkloadSg.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Allow HTTPS outbound for learning; in production narrow this as much as possible',
        );

        const s3GatewayEndpoint = vpc.addGatewayEndpoint('S3GatewayEndpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [
                { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            ],
        });

        const logsEndpoint = vpc.addInterfaceEndpoint('LogsEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [endpointSg],
            privateDnsEnabled: true,
            open: false,
        });

        const ssmEndpoint = vpc.addInterfaceEndpoint('SsmEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [endpointSg],
            privateDnsEnabled: true,
            open: false,
        });

        const ssmMessagesEndpoint = vpc.addInterfaceEndpoint('SsmMessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [endpointSg],
            privateDnsEnabled: true,
            open: false,
        });

        const ec2MessagesEndpoint = vpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [endpointSg],
            privateDnsEnabled: true,
            open: false,
        });

        const baselineRole = new iam.Role(this, 'BaselineRole', {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('ec2.amazonaws.com'),
                new iam.ServicePrincipal('lambda.amazonaws.com'),
            ),
            description: 'Baseline shared role for learning security and access patterns',
            maxSessionDuration: cdk.Duration.hours(4),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
            ],
        });

        baselineRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
                resources: [baselineBucket.bucketArn, `${baselineBucket.bucketArn}/*`],
            }),
        );

        const baselineReadLogsPolicy = new iam.ManagedPolicy(this, 'BaselineReadLogsPolicy', {
            description: 'Managed policy to read baseline CloudWatch Logs group',
            statements: [
                new iam.PolicyStatement({
                    actions: [
                        'logs:DescribeLogGroups',
                        'logs:DescribeLogStreams',
                        'logs:GetLogEvents',
                    ],
                    resources: ['*'],
                }),
            ],
        });

        baselineRole.addManagedPolicy(baselineReadLogsPolicy);

        baselineBucket.grantReadWrite(baselineRole);
        baselineLogGroup.grantWrite(baselineRole);
        baselineKey.grantEncryptDecrypt(baselineRole);

        new logs.CfnLogGroup(this, 'L1SampleLogGroup', {
            logGroupName: '/gc/baseline/security/l1-sample',
            kmsKeyId: baselineKey.keyArn,
            retentionInDays: 30,
        });

        new cdk.CfnOutput(this, 'VpcId', {
            value: vpc.vpcId,
        });

        new cdk.CfnOutput(this, 'BucketName', {
            value: baselineBucket.bucketName,
        });

        new cdk.CfnOutput(this, 'LogGroupName', {
            value: baselineLogGroup.logGroupName,
        });

        new cdk.CfnOutput(this, 'KmsKeyArn', {
            value: baselineKey.keyArn,
        });

        new cdk.CfnOutput(this, 'S3EndpointId', {
            value: s3GatewayEndpoint.vpcEndpointId,
        });

        new cdk.CfnOutput(this, 'LogsEndpointId', {
            value: logsEndpoint.vpcEndpointId,
        });

        new cdk.CfnOutput(this, 'SsmEndpointId', {
            value: ssmEndpoint.vpcEndpointId,
        });

        void ssmMessagesEndpoint;
        void ec2MessagesEndpoint;
    }
}
