import * as cdk from 'aws-cdk-lib';
// この行は 'aws-cdk-lib' を 'cdk' として読み込み、関連コンストラクトを利用可能にします。
import * as ec2 from 'aws-cdk-lib/aws-ec2';
// この行は 'aws-cdk-lib/aws-ec2' を 'ec2' として読み込み、関連コンストラクトを利用可能にします。
import * as iam from 'aws-cdk-lib/aws-iam';
// この行は 'aws-cdk-lib/aws-iam' を 'iam' として読み込み、関連コンストラクトを利用可能にします。
import * as kms from 'aws-cdk-lib/aws-kms';
// この行は 'aws-cdk-lib/aws-kms' を 'kms' として読み込み、関連コンストラクトを利用可能にします。
import * as logs from 'aws-cdk-lib/aws-logs';
// この行は 'aws-cdk-lib/aws-logs' を 'logs' として読み込み、関連コンストラクトを利用可能にします。
import * as s3 from 'aws-cdk-lib/aws-s3';
// この行は 'aws-cdk-lib/aws-s3' を 's3' として読み込み、関連コンストラクトを利用可能にします。
import { Construct } from 'constructs';
// この行は Construct 基底型を読み込み、CDK クラス継承時の型定義に利用します。

export class GcBaselineSecurityStack extends cdk.Stack {
    // この行は Stack クラス 'GcBaselineSecurityStack' を定義し、基盤リソースを 1 つのデプロイ単位にまとめます。
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        // この行はコンストラクタで、scope・id・props を受け取りスタック初期化に使います。
        super(scope, id, props);
        // この行は親クラス初期化を実行し、CDK Stack の共通設定を有効化します。

        const vpc = new ec2.Vpc(this, 'BaseVpc', {
            // この行は 'ec2.Vpc' を生成して 'vpc' に保持し、後続設定で再利用できるようにします。
            ipAddresses: ec2.IpAddresses.cidr('10.30.0.0/16'),
            // props の 'ipAddresses' は VPC の CIDR 範囲を定義し、値 'ec2.IpAddresses.cidr('10.30.0.0/16'),' で 10.30.0.0/16 を割り当てています。
            maxAzs: 2,
            // props の 'maxAzs' は利用する AZ 数で、値 '2,' により 2AZ 構成の基本可用性を確保します。
            natGateways: 1,
            // props の 'natGateways' は NAT 台数で、値 '1,' は学習用途のコスト重視構成を表します。
            restrictDefaultSecurityGroup: true,
            // props の 'restrictDefaultSecurityGroup' に 'true,' を指定し、デフォルト SG の暗黙許可を抑止して明示制御に寄せます。
            subnetConfiguration: [
                // props の 'subnetConfiguration' でサブネット設計を配列指定し、public・app・isolated を役割分離します。
                {
                    name: 'public-ingress',
                    // props の 'name' はサブネット識別名で、値 ''public-ingress',' により用途を読み取りやすくします。
                    subnetType: ec2.SubnetType.PUBLIC,
                    // props の 'subnetType' はルーティング特性を決める指定で、値 'ec2.SubnetType.PUBLIC,' に応じて到達性が変わります。
                    cidrMask: 24,
                    // props の 'cidrMask' に '24,' を指定し、各サブネットを /24 で均等に分割しています。
                },
                {
                    name: 'private-app',
                    // props の 'name' はサブネット識別名で、値 ''private-app',' により用途を読み取りやすくします。
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    // props の 'subnetType' はルーティング特性を決める指定で、値 'ec2.SubnetType.PRIVATE_WITH_EGRESS,' に応じて到達性が変わります。
                    cidrMask: 24,
                    // props の 'cidrMask' に '24,' を指定し、各サブネットを /24 で均等に分割しています。
                },
                {
                    name: 'private-isolated',
                    // props の 'name' はサブネット識別名で、値 ''private-isolated',' により用途を読み取りやすくします。
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    // props の 'subnetType' はルーティング特性を決める指定で、値 'ec2.SubnetType.PRIVATE_ISOLATED,' に応じて到達性が変わります。
                    cidrMask: 24,
                    // props の 'cidrMask' に '24,' を指定し、各サブネットを /24 で均等に分割しています。
                },
            ],
        });

        const baselineKey = new kms.Key(this, 'BaselineKey', {
            // この行は 'kms.Key' を生成して 'baselineKey' に保持し、後続設定で再利用できるようにします。
            alias: 'alias/gc/baseline/security',
            // props の 'alias' は KMS エイリアス名で、値 ''alias/gc/baseline/security',' で鍵用途を運用時に識別しやすくします。
            description:
                // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
                'KMS key for baseline security resources such as S3 and CloudWatch Logs',
            // この行は説明用文字列で、ルールの目的を 'KMS key for baseline security resources such as S3 and CloudWatch Logs' として運用時に判別しやすくします。
            enableKeyRotation: true,
            // props の 'enableKeyRotation' に 'true,' を指定し、KMS 鍵の自動ローテーションを有効化しています。
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // props の 'removalPolicy' に 'cdk.RemovalPolicy.RETAIN,' を設定し、スタック削除時もデータ保全を優先する方針です。
            pendingWindow: cdk.Duration.days(30),
            // props の 'pendingWindow' は KMS 削除待機期間で、値 'cdk.Duration.days(30),' により誤削除時の猶予を確保します。
        });

        const baselineBucket = new s3.Bucket(this, 'BaselineBucket', {
            // この行は 's3.Bucket' を生成して 'baselineBucket' に保持し、後続設定で再利用できるようにします。
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            // props の 'blockPublicAccess' に 's3.BlockPublicAccess.BLOCK_ALL,' を設定し、S3 のパブリック公開経路を全面遮断します。
            encryption: s3.BucketEncryption.KMS,
            // props の 'encryption' は保存時暗号化方式で、値 's3.BucketEncryption.KMS,' により SSE-KMS を強制します。
            encryptionKey: baselineKey,
            // props の 'encryptionKey' に 'baselineKey,' を指定し、暗号化に利用する KMS キーを統一しています。
            enforceSSL: true,
            // props の 'enforceSSL' に 'true,' を設定し、TLS 経由の安全な通信だけを許可します。
            versioned: true,
            // props の 'versioned' に 'true,' を設定し、誤更新や誤削除からの復元性を高めます。
            serverAccessLogsPrefix: 'access-logs/',
            // props の 'serverAccessLogsPrefix' はアクセスログの保存先プレフィックスで、値 ''access-logs/',' で保管位置を整理します。
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // props の 'removalPolicy' に 'cdk.RemovalPolicy.RETAIN,' を設定し、スタック削除時もデータ保全を優先する方針です。
            autoDeleteObjects: false,
            // props の 'autoDeleteObjects' に 'false,' を設定し、スタック削除時の自動消去を避けて事故を防ぎます。
            lifecycleRules: [
                // props の 'lifecycleRules' でライフサイクル制御を定義し、不要データの期限管理を自動化します。
                {
                    id: 'expire-temp-artifacts',
                    // props の 'id' はルール識別子で、値 ''expire-temp-artifacts',' により監査時の追跡性を確保します。
                    prefix: 'artifacts/temp/',
                    // props の 'prefix' で対象キー範囲を ''artifacts/temp/',' に限定し、意図したオブジェクトだけに適用します。
                    expiration: cdk.Duration.days(30),
                    // props の 'expiration' は失効日数で、値 'cdk.Duration.days(30),' により一時データの保管期間を定義します。
                    enabled: true,
                    // props の 'enabled' に 'true,' を指定し、このルールを有効状態として適用します。
                },
            ],
        });

        const baselineLogGroup = new logs.LogGroup(this, 'BaselineLogGroup', {
            // この行は 'logs.LogGroup' を生成して 'baselineLogGroup' に保持し、後続設定で再利用できるようにします。
            logGroupName: '/gc/baseline/security/main',
            // props の 'logGroupName' は LogGroup 名で、値 ''/gc/baseline/security/main',' で運用時の参照先を固定します。
            retention: logs.RetentionDays.THREE_MONTHS,
            // props の 'retention' は保持期間で、値 'logs.RetentionDays.THREE_MONTHS,' によりログ保存ポリシーを明示します。
            encryptionKey: baselineKey,
            // props の 'encryptionKey' に 'baselineKey,' を指定し、暗号化に利用する KMS キーを統一しています。
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // props の 'removalPolicy' に 'cdk.RemovalPolicy.RETAIN,' を設定し、スタック削除時もデータ保全を優先する方針です。
            logGroupClass: logs.LogGroupClass.STANDARD,
            // props の 'logGroupClass' は LogGroup クラスで、値 'logs.LogGroupClass.STANDARD,' により標準機能を利用します。
        });

        const endpointSg = new ec2.SecurityGroup(this, 'EndpointSg', {
            // この行は 'ec2.SecurityGroup' を生成して 'endpointSg' に保持し、後続設定で再利用できるようにします。
            vpc,
            // この行は既存の 'vpc' を引数に渡し、依存関係を接続するための値参照です。
            allowAllOutbound: false,
            // props の 'allowAllOutbound' に 'false,' を指定し、外向き通信をデフォルト拒否して最小許可にします。
            description: 'Security group for interface VPC endpoints',
            // props の 'description' は用途説明で、値 ''Security group for interface VPC endpoints',' によりリソースの目的を明確化します。
        });

        endpointSg.addIngressRule(
            // この行は 'endpointSg' に受信ルールを追加し、許可元とポートを明示的に管理します。
            ec2.Peer.ipv4('10.30.0.0/16'),
            // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            ec2.Port.tcp(443),
            // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            'Allow HTTPS from inside VPC to interface endpoints',
            // この行は説明用文字列で、ルールの目的を 'Allow HTTPS from inside VPC to interface endpoints' として運用時に判別しやすくします。
        );

        const sampleWorkloadSg = new ec2.SecurityGroup(this, 'SampleWorkloadSg', {
            // この行は 'ec2.SecurityGroup' を生成して 'sampleWorkloadSg' に保持し、後続設定で再利用できるようにします。
            vpc,
            // この行は既存の 'vpc' を引数に渡し、依存関係を接続するための値参照です。
            allowAllOutbound: false,
            // props の 'allowAllOutbound' に 'false,' を指定し、外向き通信をデフォルト拒否して最小許可にします。
            description: 'Sample workload SG to demonstrate endpoint access patterns',
            // props の 'description' は用途説明で、値 ''Sample workload SG to demonstrate endpoint access patterns',' によりリソースの目的を明確化します。
        });

        sampleWorkloadSg.addEgressRule(
            // この行は 'sampleWorkloadSg' に送信ルールを追加し、外向き通信を必要最小限に制御します。
            endpointSg,
            // この行は既存の 'endpointSg' を引数に渡し、依存関係を接続するための値参照です。
            ec2.Port.tcp(443),
            // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            'Allow HTTPS to interface endpoints only',
            // この行は説明用文字列で、ルールの目的を 'Allow HTTPS to interface endpoints only' として運用時に判別しやすくします。
        );

        sampleWorkloadSg.addEgressRule(
            // この行は 'sampleWorkloadSg' に送信ルールを追加し、外向き通信を必要最小限に制御します。
            ec2.Peer.anyIpv4(),
            // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            ec2.Port.tcp(443),
            // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            'Allow HTTPS outbound for learning; in production narrow this as much as possible',
            // この行は説明用文字列で、ルールの目的を 'Allow HTTPS outbound for learning; in production narrow this as much as possible' として運用時に判別しやすくします。
        );

        const s3GatewayEndpoint = vpc.addGatewayEndpoint('S3GatewayEndpoint', {
            // この行は VPC に Gateway Endpoint を追加し、S3 通信の経路を NAT 依存から分離します。
            service: ec2.GatewayVpcEndpointAwsService.S3,
            // props の 'service' で接続対象 AWS サービスを指定し、値 'ec2.GatewayVpcEndpointAwsService.S3,' の Endpoint を作成します。
            subnets: [
                // props の 'subnets' で Endpoint 適用サブネットを指定し、到達範囲を必要最小限に絞ります。
                { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                // props の 'subnetType' はルーティング特性を決める指定で、値 'ec2.SubnetType.PRIVATE_WITH_EGRESS ' に応じて到達性が変わります。
                { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
                // props の 'subnetType' はルーティング特性を決める指定で、値 'ec2.SubnetType.PRIVATE_ISOLATED ' に応じて到達性が変わります。
            ],
        });

        const logsEndpoint = vpc.addInterfaceEndpoint('LogsEndpoint', {
            // この行は VPC に Interface Endpoint を追加し、サービス接続をプライベート経路へ閉じます。
            service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
            // props の 'service' で接続対象 AWS サービスを指定し、値 'ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,' の Endpoint を作成します。
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            // props の 'subnets' で Endpoint 適用サブネットを指定し、到達範囲を必要最小限に絞ります。
            securityGroups: [endpointSg],
            // props の 'securityGroups' に SG 配列を渡し、Endpoint ENI の通信制御を統一します。
            privateDnsEnabled: true,
            // props の 'privateDnsEnabled' に 'true,' を設定し、標準ホスト名を VPC 内で私設 DNS 解決させます。
            open: false,
            // props の 'open' に 'false,' を設定し、自動的な広い開放を避けて SG で明示制御します。
        });

        const ssmEndpoint = vpc.addInterfaceEndpoint('SsmEndpoint', {
            // この行は VPC に Interface Endpoint を追加し、サービス接続をプライベート経路へ閉じます。
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
            // props の 'service' で接続対象 AWS サービスを指定し、値 'ec2.InterfaceVpcEndpointAwsService.SSM,' の Endpoint を作成します。
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            // props の 'subnets' で Endpoint 適用サブネットを指定し、到達範囲を必要最小限に絞ります。
            securityGroups: [endpointSg],
            // props の 'securityGroups' に SG 配列を渡し、Endpoint ENI の通信制御を統一します。
            privateDnsEnabled: true,
            // props の 'privateDnsEnabled' に 'true,' を設定し、標準ホスト名を VPC 内で私設 DNS 解決させます。
            open: false,
            // props の 'open' に 'false,' を設定し、自動的な広い開放を避けて SG で明示制御します。
        });

        const ssmMessagesEndpoint = vpc.addInterfaceEndpoint('SsmMessagesEndpoint', {
            // この行は VPC に Interface Endpoint を追加し、サービス接続をプライベート経路へ閉じます。
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
            // props の 'service' で接続対象 AWS サービスを指定し、値 'ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,' の Endpoint を作成します。
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            // props の 'subnets' で Endpoint 適用サブネットを指定し、到達範囲を必要最小限に絞ります。
            securityGroups: [endpointSg],
            // props の 'securityGroups' に SG 配列を渡し、Endpoint ENI の通信制御を統一します。
            privateDnsEnabled: true,
            // props の 'privateDnsEnabled' に 'true,' を設定し、標準ホスト名を VPC 内で私設 DNS 解決させます。
            open: false,
            // props の 'open' に 'false,' を設定し、自動的な広い開放を避けて SG で明示制御します。
        });

        const ec2MessagesEndpoint = vpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
            // この行は VPC に Interface Endpoint を追加し、サービス接続をプライベート経路へ閉じます。
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
            // props の 'service' で接続対象 AWS サービスを指定し、値 'ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,' の Endpoint を作成します。
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            // props の 'subnets' で Endpoint 適用サブネットを指定し、到達範囲を必要最小限に絞ります。
            securityGroups: [endpointSg],
            // props の 'securityGroups' に SG 配列を渡し、Endpoint ENI の通信制御を統一します。
            privateDnsEnabled: true,
            // props の 'privateDnsEnabled' に 'true,' を設定し、標準ホスト名を VPC 内で私設 DNS 解決させます。
            open: false,
            // props の 'open' に 'false,' を設定し、自動的な広い開放を避けて SG で明示制御します。
        });

        const baselineRole = new iam.Role(this, 'BaselineRole', {
            // この行は 'iam.Role' を生成して 'baselineRole' に保持し、後続設定で再利用できるようにします。
            assumedBy: new iam.CompositePrincipal(
                // props の 'assumedBy' でロール引受主体を定義し、どのサービスが利用できるかを限定します。
                new iam.ServicePrincipal('ec2.amazonaws.com'),
                // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
                new iam.ServicePrincipal('lambda.amazonaws.com'),
                // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            ),
            description: 'Baseline shared role for learning security and access patterns',
            // props の 'description' は用途説明で、値 ''Baseline shared role for learning security and access patterns',' によりリソースの目的を明確化します。
            maxSessionDuration: cdk.Duration.hours(4),
            // props の 'maxSessionDuration' に 'cdk.Duration.hours(4),' を設定し、長時間セッションを抑えて運用リスクを低減します。
            managedPolicies: [
                // props の 'managedPolicies' で既存管理ポリシーを束ねて付与し、標準権限を再利用します。
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
                // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
                iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
                // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            ],
        });

        baselineRole.addToPolicy(
            // この行はロールへ inline PolicyStatement を追加し、個別要件の権限を追記します。
            new iam.PolicyStatement({
                // この行は 'iam.PolicyStatement' の設定オブジェクトを開始し、以降で props を個別に指定します。
                actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
                // props の 'actions' には許可する API 操作を列挙し、必要な操作だけを明示します。
                resources: [baselineBucket.bucketArn, `${baselineBucket.bucketArn}/*`],
                // props の 'resources' には許可対象 ARN を指定し、権限の適用範囲を絞り込みます。
            }),
        );

        const baselineReadLogsPolicy = new iam.ManagedPolicy(this, 'BaselineReadLogsPolicy', {
            // この行は 'iam.ManagedPolicy' を生成して 'baselineReadLogsPolicy' に保持し、後続設定で再利用できるようにします。
            description: 'Managed policy to read baseline CloudWatch Logs group',
            // props の 'description' は用途説明で、値 ''Managed policy to read baseline CloudWatch Logs group',' によりリソースの目的を明確化します。
            statements: [
                // props の 'statements' は PolicyStatement の配列で、権限定義のまとまりを設定します。
                new iam.PolicyStatement({
                    // この行は 'iam.PolicyStatement' の設定オブジェクトを開始し、以降で props を個別に指定します。
                    actions: [
                        // props の 'actions' には許可する API 操作を列挙し、必要な操作だけを明示します。
                        'logs:DescribeLogGroups',
                        // この行は説明用文字列で、ルールの目的を 'logs:DescribeLogGroups' として運用時に判別しやすくします。
                        'logs:DescribeLogStreams',
                        // この行は説明用文字列で、ルールの目的を 'logs:DescribeLogStreams' として運用時に判別しやすくします。
                        'logs:GetLogEvents',
                        // この行は説明用文字列で、ルールの目的を 'logs:GetLogEvents' として運用時に判別しやすくします。
                    ],
                    resources: ['*'],
                    // props の 'resources' には許可対象 ARN を指定し、権限の適用範囲を絞り込みます。
                }),
            ],
        });

        baselineRole.addManagedPolicy(baselineReadLogsPolicy);
        // この行は作成済み Managed Policy をロールへ関連付け、再利用しやすい権限構成にします。

        baselineBucket.grantReadWrite(baselineRole);
        // この行は grant メソッドで S3 読み書き権限を付与し、必要な IAM ポリシーを自動生成させます。
        baselineLogGroup.grantWrite(baselineRole);
        // この行は grant メソッドでログ書き込み権限を付与し、最小構成でアクセスを通します。
        baselineKey.grantEncryptDecrypt(baselineRole);
        // この行は grant メソッドで暗号化と復号を許可し、KMS 利用権限を簡潔に付与します。

        new logs.CfnLogGroup(this, 'L1SampleLogGroup', {
            // この行は設定の一部で、前後の行と組み合わせてリソースの最終挙動を確定します。
            logGroupName: '/gc/baseline/security/l1-sample',
            // props の 'logGroupName' は LogGroup 名で、値 ''/gc/baseline/security/l1-sample',' で運用時の参照先を固定します。
            kmsKeyId: baselineKey.keyArn,
            // props の 'kmsKeyId' に 'baselineKey.keyArn,' を指定し、L1 LogGroup でも KMS 暗号化を有効化します。
            retentionInDays: 30,
            // props の 'retentionInDays' に '30,' を指定し、L1 形式でログ保持日数を明示しています。
        });

        new cdk.CfnOutput(this, 'VpcId', {
            // この行は Output 'VpcId' を定義し、デプロイ後に確認すべき値を明示します。
            value: vpc.vpcId,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        new cdk.CfnOutput(this, 'BucketName', {
            // この行は Output 'BucketName' を定義し、デプロイ後に確認すべき値を明示します。
            value: baselineBucket.bucketName,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        new cdk.CfnOutput(this, 'LogGroupName', {
            // この行は Output 'LogGroupName' を定義し、デプロイ後に確認すべき値を明示します。
            value: baselineLogGroup.logGroupName,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        new cdk.CfnOutput(this, 'KmsKeyArn', {
            // この行は Output 'KmsKeyArn' を定義し、デプロイ後に確認すべき値を明示します。
            value: baselineKey.keyArn,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        new cdk.CfnOutput(this, 'S3EndpointId', {
            // この行は Output 'S3EndpointId' を定義し、デプロイ後に確認すべき値を明示します。
            value: s3GatewayEndpoint.vpcEndpointId,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        new cdk.CfnOutput(this, 'LogsEndpointId', {
            // この行は Output 'LogsEndpointId' を定義し、デプロイ後に確認すべき値を明示します。
            value: logsEndpoint.vpcEndpointId,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        new cdk.CfnOutput(this, 'SsmEndpointId', {
            // この行は Output 'SsmEndpointId' を定義し、デプロイ後に確認すべき値を明示します。
            value: ssmEndpoint.vpcEndpointId,
            // props の 'value' に出力値を指定し、デプロイ後の参照情報を CloudFormation Output として公開します。
        });

        void ssmMessagesEndpoint;
        // この行は未使用警告を抑止するための明示で、作成済みリソースを意図的に保持していることを示します。
        void ec2MessagesEndpoint;
        // この行は未使用警告を抑止するための明示で、作成済みリソースを意図的に保持していることを示します。
    }
}
