import * as cdk from 'aws-cdk-lib';
// この行は 'aws-cdk-lib' を 'cdk' として読み込み、Stack や Duration など基礎機能を利用可能にします。
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
// この行は CloudWatch の Alarm など監視系コンストラクトを利用するために読み込みます。
import * as ec2 from 'aws-cdk-lib/aws-ec2';
// この行は VPC / SecurityGroup / SubnetType などネットワーク構成要素を扱うために読み込みます。
import * as ecs from 'aws-cdk-lib/aws-ecs';
// この行は ECS Cluster / TaskDefinition / FargateService などコンテナ基盤を扱うために読み込みます。
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
// この行は ALB / Listener / TargetGroup など L7 負荷分散リソースを扱うために読み込みます。
import * as iam from 'aws-cdk-lib/aws-iam';
// この行は IAM Role / PolicyStatement など権限制御を扱うために読み込みます。
import * as kms from 'aws-cdk-lib/aws-kms';
// この行は KMS Key など暗号化キー管理を扱うために読み込みます。
import * as logs from 'aws-cdk-lib/aws-logs';
// この行は CloudWatch Logs の LogGroup 定義を扱うために読み込みます。
import * as rds from 'aws-cdk-lib/aws-rds';
// この行は Aurora PostgreSQL Cluster などデータベース関連リソースを扱うために読み込みます。
import * as s3 from 'aws-cdk-lib/aws-s3';
// この行は S3 Bucket とライフサイクル制御などオブジェクト保管機能を扱うために読み込みます。
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// この行は Secrets Manager の Secret 作成・参照を扱うために読み込みます。
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
// この行は WAFv2 の L1 リソース (CfnWebACL など) を扱うために読み込みます。
import { Construct } from 'constructs';
// この行は Construct 基底型を読み込み、CDK クラス継承時の型定義に利用します。

export class GcFargateApiStack extends cdk.Stack {
    // この行は Stack クラス 'GcFargateApiStack' を定義し、ECS API バックエンド一式を 1 つのデプロイ単位にまとめます。
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        // この行はコンストラクタで、scope・id・props を受け取りスタック初期化に使います。
        super(scope, id, props);
        // この行は親クラス初期化を実行し、CDK Stack の共通設定を有効化します。

        const vpc = new ec2.Vpc(this, 'ApiVpc', {
            // この行は 'ec2.Vpc' を生成して 'vpc' に保持し、後続の ECS / ALB / RDS に共通利用します。
            ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
            // props の 'ipAddresses' は VPC の CIDR 範囲を定義し、学習用に十分な分割余地を持つ /16 を割り当てます。
            maxAzs: 2,
            // props の 'maxAzs' は利用する AZ 数で、2AZ により学習時点でも基本的な可用性を確保します。
            natGateways: 1,
            // props の 'natGateways' は NAT 台数で、学習用にコストを抑えつつ private-app の外向き通信を成立させます。
            restrictDefaultSecurityGroup: true,
            // props の 'restrictDefaultSecurityGroup' に 'true' を設定し、デフォルト SG の暗黙許可を抑止して明示制御に寄せます。
            subnetConfiguration: [
                // props の 'subnetConfiguration' で public / private-app / private-db の責務分離を定義します。
                {
                    name: 'public-ingress',
                    // props の 'name' はサブネット識別名で、ALB などインターネット入口用途を明示します。
                    subnetType: ec2.SubnetType.PUBLIC,
                    // props の 'subnetType' に PUBLIC を指定し、Internet Gateway 経路を持つ受信系ネットワークを作成します。
                    cidrMask: 24,
                    // props の 'cidrMask' を /24 とし、用途ごとの分割をわかりやすく管理します。
                },
                {
                    name: 'private-app',
                    // props の 'name' はサブネット識別名で、ECS タスクを配置するアプリ層であることを明示します。
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    // props の 'subnetType' に PRIVATE_WITH_EGRESS を指定し、NAT 経由の外向き通信を許可します。
                    cidrMask: 24,
                    // props の 'cidrMask' を /24 とし、アプリ層のアドレス管理を単純化します。
                },
                {
                    name: 'private-db',
                    // props の 'name' はサブネット識別名で、DB を隔離する層であることを明示します。
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    // props の 'subnetType' に PRIVATE_ISOLATED を指定し、インターネット経路を持たない DB 層を作成します。
                    cidrMask: 24,
                    // props の 'cidrMask' を /24 とし、DB 層も他層と同様の管理粒度に揃えます。
                },
            ],
        });

        const apiKey = new kms.Key(this, 'ApiKey', {
            // この行は 'kms.Key' を生成して 'apiKey' に保持し、S3 / Logs / Secrets / DB 暗号化で共通利用します。
            alias: 'alias/gc/fargate/api',
            // props の 'alias' は KMS エイリアス名で、用途を運用時に識別しやすくします。
            description: 'KMS key for ECS API stack resources',
            // props の 'description' はキー用途説明で、監査や運用引き継ぎ時の可読性を高めます。
            enableKeyRotation: true,
            // props の 'enableKeyRotation' に 'true' を設定し、鍵ローテーションを有効化します。
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // props の 'removalPolicy' に RETAIN を設定し、スタック削除時も暗号鍵を保持して復旧性を確保します。
        });

        const apiBucket = new s3.Bucket(this, 'ApiBucket', {
            // この行は 's3.Bucket' を生成して 'apiBucket' に保持し、添付ファイル・中間ファイルの外部保管先にします。
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            // props の 'blockPublicAccess' に BLOCK_ALL を設定し、誤公開経路を全面遮断します。
            encryption: s3.BucketEncryption.KMS,
            // props の 'encryption' は保存時暗号化方式で、SSE-KMS を強制します。
            encryptionKey: apiKey,
            // props の 'encryptionKey' に 'apiKey' を指定し、暗号化キーをスタック内で統一します。
            enforceSSL: true,
            // props の 'enforceSSL' に 'true' を設定し、TLS 経由通信のみ許可します。
            versioned: true,
            // props の 'versioned' に 'true' を設定し、誤更新・誤削除からの復元性を高めます。
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // props の 'removalPolicy' に RETAIN を設定し、スタック削除時もデータ保全を優先します。
            autoDeleteObjects: false,
            // props の 'autoDeleteObjects' に 'false' を設定し、スタック削除連動での一括削除事故を防ぎます。
            lifecycleRules: [
                // props の 'lifecycleRules' は temp 領域の期限管理を自動化し、保管コスト増大を抑えます。
                {
                    id: 'expire-temp-objects',
                    // props の 'id' はルール識別子で、監査時の追跡性を確保します。
                    prefix: 'temp/',
                    // props の 'prefix' で対象オブジェクトを temp 配下に限定し、意図したデータだけを期限削除します。
                    expiration: cdk.Duration.days(30),
                    // props の 'expiration' は失効日数で、一時ファイルの保持期間を 30 日に固定します。
                    enabled: true,
                    // props の 'enabled' に 'true' を指定し、ルールを有効化します。
                },
            ],
        });

        const cluster = new ecs.Cluster(this, 'ApiCluster', {
            // この行は 'ecs.Cluster' を生成して 'cluster' に保持し、Fargate サービスの論理的な配置先を定義します。
            vpc,
            // props の 'vpc' に既存 VPC を渡し、ECS リソースを同一ネットワークに配置します。
            clusterName: 'gc-fargate-api-cluster',
            // props の 'clusterName' は物理名を固定し、運用画面での識別を容易にします。
            enableFargateCapacityProviders: true,
            // props の 'enableFargateCapacityProviders' に 'true' を設定し、FARGATE/FARGATE_SPOT 戦略に備えます。
            containerInsightsV2: ecs.ContainerInsights.ENABLED,
            // props の 'containerInsightsV2' で Container Insights を有効化し、メトリクス可観測性を初期状態で確保します。
        });

        const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
            // この行は ALB 用 SecurityGroup を作成し、インターネット入口の通信制御を明示化します。
            vpc,
            // props の 'vpc' に既存 VPC を渡し、同一ネットワーク内の SG と連携可能にします。
            allowAllOutbound: false,
            // props の 'allowAllOutbound' を false にして、送信先も明示許可方式に統一します。
            description: 'Security group for public ALB',
            // props の 'description' は用途説明で、ALB 用 SG であることを明示します。
        });

        const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
            // この行は ECS サービス用 SecurityGroup を作成し、ALB からの入口と DB への出口を制御します。
            vpc,
            // この行は既存 VPC を引数に渡し、同一セグメント内の通信制御を適用可能にします。
            allowAllOutbound: false,
            // props の 'allowAllOutbound' を false にして、外向き通信を最小許可で管理します。
            description: 'Security group for ECS Fargate service',
            // props の 'description' で ECS タスク用 SG であることを明確化します。
        });

        const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
            // この行は Aurora 用 SecurityGroup を作成し、DB への到達元を ECS サービス SG に限定します。
            vpc,
            // この行は既存 VPC を引数に渡し、DB を同一 VPC の隔離サブネット上で制御します。
            allowAllOutbound: false,
            // props の 'allowAllOutbound' を false にして、DB からの不要な外向き通信を抑止します。
            description: 'Security group for Aurora PostgreSQL cluster',
            // props の 'description' で DB 用 SG であることを明示します。
        });

        albSg.addIngressRule(
            // この行は ALB SG に受信ルールを追加し、学習用に HTTP 80 をインターネットから受けます。
            ec2.Peer.anyIpv4(),
            // この行は許可元を任意 IPv4 とし、外部クライアントからのアクセスを受け付けます。
            ec2.Port.tcp(80),
            // この行は許可ポートを TCP/80 に設定します。
            'Allow HTTP from internet for learning',
            // この行はルール目的の説明文字列で、学習用途の公開であることを明記します。
        );

        albSg.addEgressRule(
            // この行は ALB SG に送信ルールを追加し、転送先を ECS サービスへ限定します。
            serviceSg,
            // この行は送信先を serviceSg に限定し、不要な横展開通信を抑制します。
            ec2.Port.tcp(8080),
            // この行は ALB からサービスコンテナの待受ポート 8080 への転送を許可します。
            'Allow traffic from ALB to ECS service',
            // この行はルール目的を説明し、ALB -> ECS の経路であることを明示します。
        );

        serviceSg.addIngressRule(
            // この行は service SG に受信ルールを追加し、ALB からのみコンテナへ到達可能にします。
            albSg,
            // この行は許可元を ALB SG に限定し、直接アクセスを遮断します。
            ec2.Port.tcp(8080),
            // この行は許可ポートをコンテナ待受の 8080 に設定します。
            'Allow ALB to Fargate tasks',
            // この行はルール目的を説明し、ALB 経由の通信だけを許可する意図を示します。
        );

        serviceSg.addEgressRule(
            // この行は service SG に DB 向け送信ルールを追加し、アプリから DB 接続を許可します。
            dbSg,
            // この行は送信先を dbSg に限定し、DB 接続先の境界を固定します。
            ec2.Port.tcp(5432),
            // この行は PostgreSQL の標準ポート 5432 を許可します。
            'Allow service to Aurora PostgreSQL',
            // この行はルール目的を説明し、サービス -> DB のみ許可する意図を示します。
        );

        serviceSg.addEgressRule(
            // この行は service SG に HTTPS 外向き通信ルールを追加し、学習用に必要な外部到達を確保します。
            ec2.Peer.anyIpv4(),
            // この行は送信先を任意 IPv4 とし、NAT 経由での外部 API・パッケージ取得などに対応します。
            ec2.Port.tcp(443),
            // この行は許可ポートを TCP/443 に限定し、暗号化通信のみ許可します。
            'Allow HTTPS outbound via NAT for learning',
            // この行は学習用の簡略化であることを説明し、実務で絞り込みが必要な点を明示します。
        );

        dbSg.addIngressRule(
            // この行は DB SG に受信ルールを追加し、ECS サービスからの DB 接続のみを許可します。
            serviceSg,
            // この行は許可元を serviceSg のみに限定し、DB への不要到達を防止します。
            ec2.Port.tcp(5432),
            // この行は許可ポートを PostgreSQL 5432 に設定します。
            'Allow ECS service to DB',
            // この行はルール目的を説明し、接続経路の責務を明確化します。
        );

        const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
            // この行は Execution Role を作成し、タスク起動時のイメージ取得やログ送信などを担当させます。
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            // props の 'assumedBy' で ECS タスクからのみ引き受け可能に制限します。
            description: 'Execution role for ECS tasks',
            // props の 'description' で実行系ロールであることを明示します。
            managedPolicies: [
                // props の 'managedPolicies' に AWS 管理ポリシーを割り当て、起動系の標準権限を付与します。
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    'service-role/AmazonECSTaskExecutionRolePolicy',
                ),
                // この行は ECR pull・CloudWatch Logs 出力・Secrets 参照など起動時に必要な基本権限を付与します。
            ],
        });

        const taskRole = new iam.Role(this, 'TaskRole', {
            // この行は Task Role を作成し、アプリケーション本体の AWS API 呼び出し権限を分離します。
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            // props の 'assumedBy' で ECS タスクからのみ引き受け可能に制限します。
            description: 'Application task role for ECS tasks',
            // props の 'description' でアプリ実行時権限のロールであることを明示します。
        });

        const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
            // この行は DB 接続情報を保持する Secret を生成し、平文パスワードのコード埋め込みを避けます。
            secretName: 'gc/fargate/api/db-master',
            // props の 'secretName' は物理名を定義し、運用で参照しやすい命名にします。
            encryptionKey: apiKey,
            // props の 'encryptionKey' に KMS キーを指定し、Secret の保存時暗号化を統一します。
            generateSecretString: {
                // props の 'generateSecretString' で username 固定 + password 自動生成の方針を定義します。
                secretStringTemplate: JSON.stringify({ username: 'appadmin' }),
                // props の 'secretStringTemplate' で username を明示値として固定します。
                generateStringKey: 'password',
                // props の 'generateStringKey' で自動生成されるキー名を password に設定します。
                excludePunctuation: true,
                // props の 'excludePunctuation' は記号除外で、接続文字列取り扱いを簡素化します。
                includeSpace: false,
                // props の 'includeSpace' に false を設定し、空白混入による運用ミスを防ぎます。
                passwordLength: 24,
                // props の 'passwordLength' で十分な長さのランダムパスワードを生成します。
            },
        });

        apiBucket.grantReadWrite(taskRole);
        // この行は grant メソッドで S3 読み書き権限を Task Role に付与し、添付ファイル操作を可能にします。
        dbSecret.grantRead(taskRole);
        // この行は Task Role に DB Secret 読み取り権限を付与し、アプリから安全に参照できるようにします。
        apiKey.grantEncryptDecrypt(taskRole);
        // この行は Task Role に暗号化・復号権限を付与し、KMS 保護対象の利用を可能にします。

        dbSecret.grantRead(taskExecutionRole);
        // この行は Execution Role に Secret 読み取り権限を付与し、起動時 secret 注入を成立させます。
        apiKey.grantDecrypt(taskExecutionRole);
        // この行は Execution Role に復号権限を付与し、secret 参照時の KMS 復号を許可します。

        const dbCluster = new rds.DatabaseCluster(this, 'ApiDbCluster', {
            // この行は Aurora PostgreSQL クラスタを生成し、API の永続データストアを構築します。
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                // props の 'engine' で Aurora PostgreSQL を選択し、クラスタ運用前提の機能を利用します。
                version: rds.AuroraPostgresEngineVersion.VER_16_4,
                // props の 'version' を 16.4 に固定し、学習時の仕様差異を抑えます。
            }),
            credentials: rds.Credentials.fromSecret(dbSecret),
            // props の 'credentials' に Secret 参照を指定し、平文資格情報をコードへ置かない方針を徹底します。
            defaultDatabaseName: 'appdb',
            // props の 'defaultDatabaseName' で初期 DB 名を定義し、接続先を明示します。
            writer: rds.ClusterInstance.provisioned('writer', {
                // props の 'writer' で書き込みインスタンスを 1 台定義し、学習用に構成を最小化します。
                instanceType: ec2.InstanceType.of(
                    ec2.InstanceClass.T4G,
                    ec2.InstanceSize.MEDIUM,
                ),
                // props の 'instanceType' は T4G.MEDIUM を指定し、学習用のコストと性能バランスを取ります。
                publiclyAccessible: false,
                // props の 'publiclyAccessible' を false にして、DB へ直接インターネット到達させません。
            }),
            readers: [],
            // props の 'readers' を空配列にし、学習段階では writer のみ構成とします。
            vpc,
            // props の 'vpc' に既存 VPC を指定し、アプリと同一ネットワークに統合します。
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            // props の 'vpcSubnets' で DB を isolated サブネットに固定し、外向き経路を持たせません。
            securityGroups: [dbSg],
            // props の 'securityGroups' に dbSg を指定し、許可元を ECS サービスに限定します。
            storageEncrypted: true,
            // props の 'storageEncrypted' に true を設定し、DB ストレージ暗号化を有効化します。
            storageEncryptionKey: apiKey,
            // props の 'storageEncryptionKey' に apiKey を指定し、暗号化キー管理を統一します。
            backup: {
                // props の 'backup' はバックアップ保持方針を定義し、復旧可能性を確保します。
                retention: cdk.Duration.days(7),
                // props の 'retention' で 7 日保持を指定し、学習用に最低限の保護を設定します。
            },
            deletionProtection: false,
            // props の 'deletionProtection' は学習用に false とし、実務では true を前提に再評価します。
            removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
            // props の 'removalPolicy' は SNAPSHOT にして、削除時にもデータ退避を残します。
        });

        const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
            // この行は CloudWatch Logs 用 LogGroup を生成し、ECS コンテナログの保存先を定義します。
            logGroupName: '/gc/fargate/api/app',
            // props の 'logGroupName' で運用参照しやすい固定名を設定します。
            retention: logs.RetentionDays.ONE_MONTH,
            // props の 'retention' でログ保持期間を明示し、容量と監査要件のバランスを取ります。
            encryptionKey: apiKey,
            // props の 'encryptionKey' に KMS キーを指定し、ログの保存時暗号化を有効化します。
            logGroupClass: logs.LogGroupClass.STANDARD,
            // props の 'logGroupClass' は STANDARD を選択し、標準機能を利用します。
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // props の 'removalPolicy' は RETAIN を指定し、スタック削除時にもログ調査可能性を残します。
        });

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
            // この行は Fargate TaskDefinition を作成し、CPU/メモリと IAM ロール境界を定義します。
            cpu: 512,
            // props の 'cpu' はタスク全体の vCPU ユニットで、学習用に 512 を指定します。
            memoryLimitMiB: 1024,
            // props の 'memoryLimitMiB' はタスク全体メモリで、学習用に 1024MiB を指定します。
            executionRole: taskExecutionRole,
            // props の 'executionRole' に起動系ロールを設定し、ECR pull・ログ出力などを担当させます。
            taskRole,
            // props の 'taskRole' にアプリ実行ロールを設定し、業務 API 権限を分離します。
            runtimePlatform: {
                // props の 'runtimePlatform' で OS/CPU アーキテクチャを明示的に固定します。
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                // props の 'operatingSystemFamily' は LINUX を指定します。
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
                // props の 'cpuArchitecture' は X86_64 を指定し、学習用互換性を優先します。
            },
        });

        taskDefinition.addContainer('ApiContainer', {
            // この行はコンテナ定義を TaskDefinition に追加し、実際に起動する API プロセス設定を記述します。
            containerName: 'api',
            // props の 'containerName' はタスク内識別名で、運用時の可読性を確保します。
            image: ecs.ContainerImage.fromRegistry(
                'public.ecr.aws/docker/library/nginx:stable-alpine',
            ),
            // props の 'image' は学習用に public image を利用し、実務では ECR + CI/CD へ置き換える前提です。
            command: [
                // props の 'command' は nginx の待受ポートを 8080 に変更する起動コマンドを指定します。
                'sh',
                // この行は shell 実行のエントリを指定します。
                '-c',
                // この行は shell へ渡すコマンド文字列モードを指定します。
                "sed -i 's/listen       80;/listen 8080;/g' /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'",
                // この行は 80 を 8080 へ置換し、フォアグラウンドで nginx を起動させます。
            ],
            cpu: 256,
            // props の 'cpu' はコンテナ単位の CPU 割り当てで、タスク内リソース配分を定義します。
            memoryLimitMiB: 512,
            // props の 'memoryLimitMiB' はコンテナ単位メモリで、タスク内リソース配分を定義します。
            logging: ecs.LogDrivers.awsLogs({
                // props の 'logging' で awsLogs ドライバを設定し、CloudWatch Logs へ集約します。
                logGroup: apiLogGroup,
                // props の 'logGroup' に作成済み LogGroup を指定します。
                streamPrefix: 'api',
                // props の 'streamPrefix' はログストリーム識別子で、タスクごとの追跡性を高めます。
            }),
            environment: {
                // props の 'environment' には非機密の実行時パラメータを定義します。
                APP_ENV: 'dev',
                // この行はアプリ環境識別子を設定します。
                APP_PORT: '8080',
                // この行はアプリ待受ポートを設定します。
                DB_HOST: dbCluster.clusterEndpoint.hostname,
                // この行は DB ホスト名として Aurora クラスタエンドポイントを注入します。
                DB_PORT: '5432',
                // この行は DB ポートを設定します。
                DB_NAME: 'appdb',
                // この行は接続先 DB 名を設定します。
                S3_BUCKET_NAME: apiBucket.bucketName,
                // この行はアプリが利用するバケット名を注入します。
            },
            secrets: {
                // props の 'secrets' で機密情報を Secret から注入し、環境変数への平文直書きを避けます。
                DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
                // この行は username を Secret の username キーから取得します。
                DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
                // この行は password を Secret の password キーから取得します。
            },
            portMappings: [
                // props の 'portMappings' でコンテナ待受ポートを ECS へ公開します。
                {
                    containerPort: 8080,
                    // props の 'containerPort' はアプリ待受ポート 8080 を指定します。
                    protocol: ecs.Protocol.TCP,
                    // props の 'protocol' は TCP を指定します。
                },
            ],
            healthCheck: {
                // props の 'healthCheck' はコンテナ内部ヘルス判定を設定し、異常時置換判断に利用します。
                command: ['CMD-SHELL', 'wget -qO- http://localhost:8080/ || exit 1'],
                // props の 'command' は localhost 8080 へ疎通確認し、失敗時に異常終了させます。
                interval: cdk.Duration.seconds(30),
                // props の 'interval' はヘルスチェック間隔を 30 秒に設定します。
                timeout: cdk.Duration.seconds(5),
                // props の 'timeout' は応答待ち時間を 5 秒に設定します。
                retries: 3,
                // props の 'retries' は失敗許容回数を 3 回に設定します。
                startPeriod: cdk.Duration.seconds(10),
                // props の 'startPeriod' は起動直後の猶予時間を 10 秒に設定します。
            },
        });
        // この構成は学習用に low-level ECS construct を明示しており、実務では ecs_patterns との比較検討で理解が深まります。

        const apiService = new ecs.FargateService(this, 'ApiService', {
            // この行は FargateService を生成し、TaskDefinition の常駐稼働と置換戦略を定義します。
            cluster,
            // props の 'cluster' に配置先 ECS Cluster を指定します。
            taskDefinition,
            // props の 'taskDefinition' に起動するタスク定義を指定します。
            serviceName: 'gc-fargate-api-service',
            // props の 'serviceName' は運用識別しやすい固定名を設定します。
            desiredCount: 2,
            // props の 'desiredCount' は常時 2 タスクを維持し、最小限の冗長性を確保します。
            assignPublicIp: false,
            // props の 'assignPublicIp' を false にし、タスクへ直接パブリック IP を付与しません。
            securityGroups: [serviceSg],
            // props の 'securityGroups' に serviceSg を指定し、許可通信を最小化します。
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            // props の 'vpcSubnets' で private-app サブネットへ配置し、ALB 経由の公開モデルに固定します。
            enableExecuteCommand: true,
            // props の 'enableExecuteCommand' を有効化し、運用時のデバッグ接続性を確保します。
            healthCheckGracePeriod: cdk.Duration.seconds(60),
            // props の 'healthCheckGracePeriod' は起動直後の ALB 判定猶予を 60 秒に設定します。
            minHealthyPercent: 100,
            // props の 'minHealthyPercent' はローリング更新時の最低健全タスク比率を 100% に設定します。
            maxHealthyPercent: 200,
            // props の 'maxHealthyPercent' は更新時の一時増加上限を 200% に設定します。
        });

        const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
            // この行は Application Load Balancer を生成し、インターネット入口として API へ転送します。
            vpc,
            // props の 'vpc' に既存 VPC を指定し、配下ターゲットと同一ネットワーク上で動作させます。
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            // props の 'vpcSubnets' で public サブネットへ配置し、外部クライアントから到達可能にします。
            internetFacing: true,
            // props の 'internetFacing' を true に設定し、公開 ALB として動作させます。
            securityGroup: albSg,
            // props の 'securityGroup' に albSg を指定し、受信・送信制御を明示します。
            deletionProtection: false,
            // props の 'deletionProtection' は学習用に false とし、実務では true を再検討します。
            dropInvalidHeaderFields: true,
            // props の 'dropInvalidHeaderFields' は不正ヘッダを破棄し、境界防御を強化します。
            idleTimeout: cdk.Duration.seconds(60),
            // props の 'idleTimeout' はアイドル接続タイムアウトを 60 秒に設定します。
        });

        const listener = alb.addListener('HttpListener', {
            // この行は ALB Listener を追加し、HTTP 80 の受信窓口を構成します。
            port: 80,
            // props の 'port' は受信ポート 80 を設定します。
            open: false,
            // props の 'open' を false にして自動許可を無効化し、SG で明示許可します。
        });

        const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
            // この行は TargetGroup を作成し、ALB から ECS タスクへのルーティング先を定義します。
            vpc,
            // props の 'vpc' はターゲットが所属する VPC を指定します。
            protocol: elbv2.ApplicationProtocol.HTTP,
            // props の 'protocol' は HTTP を指定します。
            port: 8080,
            // props の 'port' はターゲット側待受ポートを 8080 に設定します。
            targetType: elbv2.TargetType.IP,
            // props の 'targetType' は Fargate 前提で IP を指定し、ENI のプライベート IP へ転送します。
            healthCheck: {
                // props の 'healthCheck' はターゲット正常性判定を定義し、置換判断の基礎データにします。
                enabled: true,
                // props の 'enabled' でヘルスチェックを有効化します。
                path: '/',
                // props の 'path' はチェック対象 URL パスを指定します。
                healthyHttpCodes: '200-399',
                // props の 'healthyHttpCodes' は正常判定コード範囲を定義します。
                interval: cdk.Duration.seconds(30),
                // props の 'interval' は実行間隔を 30 秒に設定します。
                timeout: cdk.Duration.seconds(5),
                // props の 'timeout' は応答待ち時間を 5 秒に設定します。
                healthyThresholdCount: 2,
                // props の 'healthyThresholdCount' は連続成功回数 2 で正常復帰とします。
                unhealthyThresholdCount: 2,
                // props の 'unhealthyThresholdCount' は連続失敗回数 2 で異常判定とします。
            },
        });

        listener.addTargetGroups('DefaultTg', {
            // この行は Listener のデフォルト転送先に apiTargetGroup を設定します。
            targetGroups: [apiTargetGroup],
            // props の 'targetGroups' にターゲットグループ配列を渡し、受信トラフィックを転送します。
        });

        apiService.attachToApplicationTargetGroup(apiTargetGroup);
        // この行は ECS サービスを TargetGroup へアタッチし、タスク IP を登録対象にします。

        listener.connections.allowDefaultPortFrom(
            // この行は Listener 接続ルールに明示許可を追加し、open=false 構成での受信を成立させます。
            ec2.Peer.anyIpv4(),
            // この行は許可元を任意 IPv4 に設定し、学習用の公開 API として動作させます。
            'Allow HTTP from internet',
            // この行はルール目的を説明し、インターネットからの HTTP 許可であることを明示します。
        );

        const scalableTarget = apiService.autoScaleTaskCount({
            // この行は Service Auto Scaling の対象を作成し、タスク数の上下限を定義します。
            minCapacity: 2,
            // props の 'minCapacity' は最小タスク数を 2 に設定し、冗長性を維持します。
            maxCapacity: 4,
            // props の 'maxCapacity' は最大タスク数を 4 に設定し、負荷上昇時の拡張余地を確保します。
        });

        scalableTarget.scaleOnCpuUtilization('CpuScaling', {
            // この行は CPU ベースのスケーリングポリシーを追加し、需要変動へ追従させます。
            targetUtilizationPercent: 60,
            // props の 'targetUtilizationPercent' は目標 CPU 利用率を 60% に設定します。
            scaleInCooldown: cdk.Duration.seconds(60),
            // props の 'scaleInCooldown' は縮退クールダウンを 60 秒に設定し、頻繁な揺れを抑えます。
            scaleOutCooldown: cdk.Duration.seconds(60),
            // props の 'scaleOutCooldown' は拡張クールダウンを 60 秒に設定し、過剰スケールを抑えます。
        });

        new cloudwatch.Alarm(this, 'ServiceHighCpuAlarm', {
            // この行は ECS サービス高 CPU アラームを作成し、性能劣化の兆候を検知します。
            metric: apiService.metricCpuUtilization({
                // props の 'metric' でサービス CPU 利用率メトリクスを監視対象に指定します。
                period: cdk.Duration.minutes(5),
                // props の 'period' は 5 分粒度で集計します。
                statistic: 'Average',
                // props の 'statistic' は平均値を評価し、短期ノイズの影響を下げます。
            }),
            threshold: 80,
            // props の 'threshold' は閾値 80% 以上で警戒とします。
            evaluationPeriods: 2,
            // props の 'evaluationPeriods' は 2 期間連続評価で判定します。
            datapointsToAlarm: 2,
            // props の 'datapointsToAlarm' は 2 点とも条件一致でアラーム化します。
            comparisonOperator:
                cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            // props の 'comparisonOperator' は閾値以上を異常判定にします。
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            // props の 'treatMissingData' は欠損時を非異常扱いにし、誤検知を抑えます。
        });

        new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
            // この行は ALB 側 5xx アラームを作成し、入口障害や過負荷兆候を検知します。
            metric: alb.metricHttpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
                // props の 'metric' で ELB 5XX カウントを監視対象に指定します。
                period: cdk.Duration.minutes(5),
                // props の 'period' は 5 分粒度で集計します。
                statistic: 'Sum',
                // props の 'statistic' は合計値を使い、エラー総量を評価します。
            }),
            threshold: 1,
            // props の 'threshold' は 1 件以上でアラームとし、早期検知を優先します。
            evaluationPeriods: 1,
            // props の 'evaluationPeriods' は 1 期間で即時判定します。
            comparisonOperator:
                cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            // props の 'comparisonOperator' は閾値以上を異常判定にします。
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            // props の 'treatMissingData' は欠損を非異常扱いにします。
        });

        const albWebAcl = new wafv2.CfnWebACL(this, 'AlbWebAcl', {
            // この行は WAFv2 WebACL を L1 で作成し、ALB 入口での防御ルールを定義します。
            defaultAction: { allow: {} },
            // props の 'defaultAction' は既定動作を allow にし、ルールで明示ブロックする設計にします。
            scope: 'REGIONAL',
            // props の 'scope' は ALB 対応の REGIONAL を指定します。
            visibilityConfig: {
                // props の 'visibilityConfig' で WAF メトリクス・サンプル取得を有効化します。
                cloudWatchMetricsEnabled: true,
                // この行は CloudWatch メトリクス出力を有効にします。
                metricName: 'gc-fargate-api-web-acl',
                // この行はメトリクス名を設定し、運用時に識別しやすくします。
                sampledRequestsEnabled: true,
                // この行はサンプルリクエスト収集を有効にし、検知調整に活用します。
            },
            rules: [
                // props の 'rules' で適用するマネージドルール群を定義します。
                {
                    name: 'AWSManagedCommonRuleSet',
                    // props の 'name' はルール名で、一般的攻撃対策のセットを識別します。
                    priority: 0,
                    // props の 'priority' は評価順序で、最優先ルールとして 0 を指定します。
                    overrideAction: { none: {} },
                    // props の 'overrideAction' は managed rule の判定をそのまま適用します。
                    statement: {
                        // props の 'statement' でマネージドルールグループを参照します。
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            // props の 'vendorName' は AWS 提供マネージドルールを指定します。
                            name: 'AWSManagedRulesCommonRuleSet',
                            // props の 'name' は一般的な Web 攻撃を検知する共通ルールセットです。
                        },
                    },
                    visibilityConfig: {
                        // この visibilityConfig はルール単位の可観測性設定です。
                        cloudWatchMetricsEnabled: true,
                        // この行はルール単位メトリクスを有効化します。
                        metricName: 'gc-fargate-api-common-rules',
                        // この行はルール単位メトリクス名を設定します。
                        sampledRequestsEnabled: true,
                        // この行はルール単位サンプル収集を有効化します。
                    },
                },
            ],
        });

        new wafv2.CfnWebACLAssociation(this, 'AlbWebAclAssociation', {
            // この行は WebACL を ALB に関連付け、入口トラフィックへ WAF を適用します。
            resourceArn: alb.loadBalancerArn,
            // props の 'resourceArn' は関連付け対象 ALB の ARN を指定します。
            webAclArn: albWebAcl.attrArn,
            // props の 'webAclArn' は適用する WebACL ARN を指定します。
        });

        new cdk.CfnOutput(this, 'AlbDnsName', {
            // この行は ALB DNS 名を Output し、デプロイ後の疎通確認先を明示します。
            value: alb.loadBalancerDnsName,
            // props の 'value' に ALB DNS 名を設定します。
        });

        new cdk.CfnOutput(this, 'EcsClusterName', {
            // この行は ECS Cluster 名を Output し、運用確認をしやすくします。
            value: cluster.clusterName,
            // props の 'value' に Cluster 名を設定します。
        });

        new cdk.CfnOutput(this, 'EcsServiceName', {
            // この行は ECS Service 名を Output し、デプロイ後の参照先を明示します。
            value: apiService.serviceName,
            // props の 'value' に Service 名を設定します。
        });

        new cdk.CfnOutput(this, 'TaskDefinitionFamily', {
            // この行は TaskDefinition family を Output し、リビジョン追跡の基点を明示します。
            value: taskDefinition.family,
            // props の 'value' に family 名を設定します。
        });

        new cdk.CfnOutput(this, 'AuroraEndpoint', {
            // この行は Aurora endpoint を Output し、接続確認に利用します。
            value: dbCluster.clusterEndpoint.hostname,
            // props の 'value' にクラスタエンドポイント FQDN を設定します。
        });

        new cdk.CfnOutput(this, 'ApiBucketName', {
            // この行は S3 バケット名を Output し、アプリ連携や運用確認に利用します。
            value: apiBucket.bucketName,
            // props の 'value' にバケット名を設定します。
        });

        new cdk.CfnOutput(this, 'ApiLogGroupName', {
            // この行は LogGroup 名を Output し、ログ確認先を明示します。
            value: apiLogGroup.logGroupName,
            // props の 'value' にロググループ名を設定します。
        });

        new cdk.CfnOutput(this, 'AlbWebAclArn', {
            // この行は WAF ARN を Output し、WAF 適用確認や監査参照を容易にします。
            value: albWebAcl.attrArn,
            // props の 'value' に WebACL ARN を設定します。
        });

        // この stack は API バックエンドに限定した学習用実装です。
        // 実務では認証認可 (Cognito / IdP)、CloudFront、ACM、HTTPS リスナー、Route53、CI/CD、
        // WAF ルール調整、Parameter Store、VPC Endpoint などを要件に応じて追加検討します。
        // セッションはコンテナ内部に保持せず、必要なら ElastiCache / DynamoDB / RDS / MemoryDB などへ外出しします。
        // public image 利用は学習簡略化であり、実務では ECR + pipeline でイメージを配布します。
    }
}
