//⭐️コメントアウトの解説無し。
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class GcReplatformWebAppStack extends cdk.Stack {
  //スタック定義　名前はGc～、extendsで親クラスの機能を引き継ぐ、継承元はcdk（上でインポートしたcdkライブラリ）のstackクラス。
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    //コンストラクト作成の処理　どこにぶら下げるか、scope：Construct
    //id：論理id（識別用のローカル）idが変数名でstringは文字列型。
    //cdk.Stackprops：スタック作成時のオプション設定、?は省略可能≒任意 cdk.StackPropsは型
    super(scope, id, props);
    //初期化処理。Typescript・Javascriptのクラスは派生クラスのConstruct内でthisを使う前にsuper(...)を呼ばないとエラーになる。

    const vpc = new ec2.Vpc(this, 'AppVpc', { //vpc作成、ec2モジュールの中のvpcライブラリ、必須props無し
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),//ipアドレスがcidr10.20.0.0/16の範囲
      maxAzs: 2,//maxのazが2
      natGateways: 1,//NATGWは1
      restrictDefaultSecurityGroup: true,//デフォのSGを無効化するかどうか
      // （cdk.jsonで無効化を有効（スイッチのような）にしてる場合は、デフォtrue。そうでなければデフォはfalse。
      subnetConfiguration: [//subnet設定。デフォはAZ1につき、パブリック＆プラベ1ずつ。
        {
          name: 'public-ingress',//サブネット名。CDK上のサブネットグループ名
          subnetType: ec2.SubnetType.PUBLIC,//enumでSubnetTypeの指定、IGWありのパブリックサブネット。
          cidrMask: 24,//cidrは/24。
        },
        {
          name: 'private-app',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,//外には出れる（NATGW）、内側に入れない。
          //PRIVATE_WITH_NATもあるけど、これは古く非推奨。基本的にEGRESSを使うように公式も言ってる。
          cidrMask: 24,
        },
        {
          name: 'private-db',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,//完全にプラベ。外へ出る必要もない＝NATGWも必要ない。
          cidrMask: 24,
        },
      ],
    });

    const appKey = new kms.Key(this, 'AppKey', { //KMSモジュールの中のkeyクラス、Key作成。必須propsは無し。
      alias: 'alias/gc/replatform/app', //初期エイリアス、メソッドを使えば後から追加可能。
      description: 'KMS key for S3, Secrets Manager, and logs in the replatform learning stack',//説明。
      enableKeyRotation: true,//キーローテ。
      removalPolicy: cdk.RemovalPolicy.RETAIN,//削除ポリシー。RETAINはstackが削除されても残す。
    });

    const appBucket = new s3.Bucket(this, 'AppBucket', { //app用のs3バケット作成。s3モジュールの中の、bucketクラス。
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,//必須propsは無し、パブリックアクセスの全ブロックをオン。
      //s3のBlock～クラスを使う、ACLのみBlock、その他色々なblock設定がある。
      encryption: s3.BucketEncryption.KMS,//暗号化するか、型はBucket～、今回はKMSを選択。
      encryptionKey: appKey,//暗号化に何のkeyを使うか、appKey（上で作成）
      enforceSSL: true,//HTTPSの接続のみ許可。
      versioned: true,//S3のバージョニングをオン。
      removalPolicy: cdk.RemovalPolicy.RETAIN,//削除ポリシーをRETAIN。
      autoDeleteObjects: false,//boolean、trueにしたい場合は、削除ポリシーをRETAIN→DESTROYにする必要あり。
      //その他、trueにしたS3バケットを古いバージョンのCDKでfalseにした場合にオブジェクトが消えるとかもあるので注意。
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {//SG、ALB用。必須propsはvpc。
      vpc,//オブジェクトリテラルのプロパティ省略記法、同じ名前（変数）ならスキップできる
      allowAllOutbound: false,//全アウトバウンド設定を無効化
      description: 'Security group for public ALB',//説明
    });

    const appSg = new ec2.SecurityGroup(this, 'AppSg', {//SG,app用。
      vpc,
      allowAllOutbound: false,
      description: 'Security group for application EC2 instance',
    });

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {//SG、DB用。
      vpc,
      allowAllOutbound: false,
      description: 'Security group for RDS PostgreSQL',
    });

    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from internet for learning');
    //ev2モジュール > SGのメソッド。
    albSg.addEgressRule(appSg, ec2.Port.tcp(8080), 'Allow traffic from ALB to app instances');

    appSg.addIngressRule(albSg, ec2.Port.tcp(8080), 'Allow ALB to app');
    appSg.addEgressRule(dbSg, ec2.Port.tcp(5432), 'Allow app to PostgreSQL');
    appSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS outbound for package/API access via NAT',
    );

    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), 'Allow app instance to DB');

    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: 'gc/replatform/app/db-master',
      encryptionKey: appKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'appadmin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 24,
      },
    });

    const appInstanceRole = new iam.Role(this, 'AppInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for application EC2 instance',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    appInstanceRole.attachInlinePolicy(
      new iam.Policy(this, 'AppInstanceInlinePolicy', {
        statements: [
          new iam.PolicyStatement({
            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
            resources: [appBucket.arnForObjects('*')],
          }),
          new iam.PolicyStatement({
            actions: ['s3:ListBucket'],
            resources: [appBucket.bucketArn],
          }),
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            resources: [dbSecret.secretArn],
          }),
          new iam.PolicyStatement({
            actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
            resources: [appKey.keyArn],
          }),
        ],
      }),
    );

    appBucket.grantReadWrite(appInstanceRole);
    dbSecret.grantRead(appInstanceRole);

    const appInstance = new ec2.Instance(this, 'AppInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: appSg,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role: appInstanceRole,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            encrypted: true,
            kmsKey: appKey,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
      detailedMonitoring: true,
    });

    appInstance.userData.addCommands(
      'dnf update -y',
      'dnf install -y nginx',
      "sed -i 's/listen       80;/listen       8080;/g' /etc/nginx/nginx.conf",
      "sed -i 's/listen       \\[::\\]:80;/listen       [::]:8080;/g' /etc/nginx/nginx.conf",
      "cat <<'EOF' > /usr/share/nginx/html/index.html",
      '<html><body><h1>GC Replatform Learning Stack</h1><p>App server is running.</p></body></html>',
      'EOF',
      'systemctl enable nginx',
      'systemctl start nginx',
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: cdk.Duration.seconds(60),
      dropInvalidHeaderFields: true,
      deletionProtection: false,
    });

    const listener = alb.addListener('HttpListener', {
      port: 80,
      open: false,
    });

    const appTg = new elbv2.ApplicationTargetGroup(this, 'AppTg', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: [appInstance],
      healthCheck: {
        enabled: true,
        path: '/',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
    });

    listener.addTargetGroups('DefaultTg', {
      targetGroups: [appTg],
    });

    listener.connections.allowDefaultPortFrom(ec2.Peer.anyIpv4(), 'Allow HTTP from internet');

    const dbInstance = new rds.DatabaseInstance(this, 'AppDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'appdb',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      allocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      kmsKey: appKey,
      multiAz: false,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deleteAutomatedBackups: false,
      cloudwatchLogsExports: ['postgresql'],
      monitoringInterval: cdk.Duration.seconds(60),
    });

    const appLogGroup = new logs.LogGroup(this, 'AppLogGroup', {
      logGroupName: '/gc/replatform/app/app',
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: appKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new logs.CfnLogGroup(this, 'AuditLikeLogGroup', {
      logGroupName: '/gc/replatform/app/l1-sample',
      kmsKeyId: appKey.keyArn,
      retentionInDays: 30,
    });

    new cloudwatch.Alarm(this, 'HighCpuAlarm', {
      metric: appInstance.metricCpuUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'DbHighCpuAlarm', {
      metric: dbInstance.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: appBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'RdsEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
    });

    new cdk.CfnOutput(this, 'Ec2InstanceId', {
      value: appInstance.instanceId,
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: appLogGroup.logGroupName,
    });
  }
}
