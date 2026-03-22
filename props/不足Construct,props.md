## 結論 📌

4つの `ts` には、すでに **`Vpc / SecurityGroup / KMS Key / S3 Bucket / LogGroup / IAM Role / Secret / EC2 Instance / ALB / ApplicationTargetGroup / RDS(Aurora含む) / ECS Cluster / FargateTaskDefinition / FargateService / CloudWatch Alarm / WAF / VPC Endpoint`** あたりは入っています。  

そのうえで、`so-su.zip` 内の PDF 群を横断して、**Windows リプレイス + ガバメントクラウド実務**で優先度が高いのに **まだ入っていない Construct** を絞ると、先に見るべきなのは次です。

### 最優先で追加候補にしたいもの

* **`autoscaling.AutoScalingGroup`**
* **`backup.BackupPlan`**
* **`cloudfront.Distribution`**
* **`certificatemanager.Certificate`**
* **`route53.HostedZone` / `route53.ARecord`**
* **`lambda.Function`**
* **`apigateway.RestApi` または `apigatewayv2.HttpApi`**
* **`cognito.UserPool`**
* **`dynamodb.Table`**
* **`scheduler.CfnSchedule`**
* **`stepfunctions.StateMachine`**
* **`cloudtrail.Trail`**
* **`config.CfnConfigurationRecorder` + `config.CfnDeliveryChannel`**
* **`fsx.CfnFileSystem`**（Windows 寄りの推論）

GCAS/デジタル庁側の大きい流れとしては、**Replatform でもオートスケール・Multi-AZ・状態の外出し・ファイルの外出し・ジョブ管理のマネージド化・イベントドリブン化・定量的計測**が繰り返し出てきます。  

---

# まず差分の見方 🧭

## 事実

今の4ファイルは、かなり **「VPC + EC2/ECS + ALB + RDS + S3 + KMS + Logs + Alarm」** に寄っています。
つまり、**土台のインフラ**は触れている一方で、まだ薄いのは次の領域です。 

* **EC2 の台数制御 / 無停止更新**
* **バックアップ統制**
* **DNS / 証明書 / CDN**
* **API 化 / 認証基盤**
* **セッション外出し**
* **イベント / ジョブ**
* **監査 / 構成記録**

---

---

# 1. コンピューティング / リプレイス基盤 🖥️

## 1-1. `autoscaling.AutoScalingGroup` ✅ 最優先

### これを足したい理由

Replatform のクラウド活用資料では、**オートスケール導入**と **複数 AZ 利用** を推奨しています。今の EC2 側スタックは `ec2.Instance` 単体なので、**Windows リプレイスの実務寄り**にするなら、まずここが差分の本命です。

### 主要 props

* `vpc`
* `vpcSubnets`
* `instanceType`
* `machineImage`
* `launchTemplate`
* `minCapacity`
* `maxCapacity`
* `healthChecks`
* `securityGroup`
* `role`
* `requireImdsv2`
* `ssmSessionPermissions`
* `userData`
* `updatePolicy`

### どこで効くか

* EC2 1台構成 → **冗長化**
* パッチ / AMI 更新 → **Rolling / Replace がしやすい**
* ALB 配下の Web/AP サーバ → **実務っぽさが一気に上がる**

CDK の `AutoScalingGroup` は、起動する VPC、インスタンスタイプ、AMI、最小/最大台数、ヘルスチェック、IAM ロール、SSM セッション権限、ユーザーデータなどを中心に持ちます。([AWS ドキュメント][1])

---

## 1-2. `backup.BackupPlan` ✅ 最優先

### これを足したい理由

RDB 移行ノウハウでは、災害対策・バックアップの整理で **AWS Backup** が明示的に出ています。特に Windows リプレイスでは、**RDS だけでなく EC2 / FSx / EFS も含めた横断バックアップ**の学習価値が高いです。

### 主要 props

* `backupPlanName`
* `backupPlanRules`
* `backupVault`
* `windowsVss`

### 実務での見どころ

* **日次 / 週次 / 月次**のルール化
* 保管先 Vault の分離
* Windows 系なら **`windowsVss`** を意識

`BackupPlan` は、プラン名・ルール・バックアップ先 Vault・Windows VSS の有効化を主要 props として持ちます。([AWS ドキュメント][2])

---

## 1-3. `fsx.CfnFileSystem` ⚠️ Windows 案件では優先度高め（推論）

### これは「事実」ではなく「推論」

GCAS の Replatform/推奨構成系 PDF 群には **FSx** が出ており、**Windows リプレイス**という前提を置くと、共有ファイルサーバや Windows 系ワークロードの置き換え先として優先度は高めです。
ただし、**全案件で必須ではありません**。アプリが S3 化できるなら、先に S3 化のほうが GCAS 方針には寄りやすいです。

### 主要 props

* `fileSystemType`
* `subnetIds`
* `securityGroupIds`
* `storageCapacity`
* `storageType`
* `kmsKeyId`
* `backupId`
* `windowsConfiguration`

### 使いどころ

* オンプレの共有フォルダ移行
* Windows アプリが **SMB / NTFS / AD 連携前提**
* すぐに S3 化できない段階の **つなぎ**

`CfnFileSystem` は L1 で、FSx の種別・サブネット・SG・容量・KMS・Windows 向け設定を持ちます。([AWS ドキュメント][3])

---

# 2. 公開系 / DNS / 証明書 / CDN 🌐

## 2-1. `cloudfront.Distribution` ✅ 優先度高

### これを足したい理由

GCAS のリファレンスアーキテクチャでは、**静的フロント配信は CloudFront + S3 + WAF** が何度も出ます。今の stack は **ALB 直公開寄り**なので、**公開フロントの実務感**を上げるなら未登場差分として大きいです。

### 主要 props

* `defaultBehavior`
* `additionalBehaviors`
* `certificate`
* `domainNames`
* `defaultRootObject`
* `enableLogging`
* `logBucket`
* `minimumProtocolVersion`
* `priceClass`
* `webAclId`
* `errorResponses`

### 実務での見どころ

* `/api/*` と `/` で **Behavior 分離**
* **WAF 紐付け**
* **ログ保管**
* カスタムドメイン + HTTPS

`Distribution` は、デフォルト Behavior、追加 Behavior、証明書、独自ドメイン、ログ、TLS 最低バージョン、WAF 紐付けなどを持ちます。([AWS ドキュメント][4])

---

## 2-2. `certificatemanager.Certificate` ✅ 優先度高

### これを足したい理由

ALB / CloudFront / Cognito カスタムドメインをやるなら、証明書は避けて通れません。今の stack は HTTP 学習用なので、**実務寄せ**なら次はここです。

### 主要 props

* `domainName`
* `validation`
* `subjectAlternativeNames`
* `keyAlgorithm`
* `certificateName`
* `transparencyLoggingEnabled`

### 実務での見どころ

* `validation: CertificateValidation.fromDns(...)`
* SAN で `www` や `api` をまとめる
* CloudFront 向けは **us-east-1** を意識

`Certificate` は FQDN、検証方法、SAN、鍵アルゴリズム、透過ログ設定などを主要 props とします。([AWS ドキュメント][5])

---

## 2-3. `route53.HostedZone` / `route53.ARecord` ✅ 優先度高

### これを足したい理由

今の stack は `ALB DNS name` を出力するだけで、**独自ドメイン運用**が未登場です。GCAS 実務では、公開/閉域問わず **DNS 設計**を避けにくいです。

### 主要 props

#### `HostedZone`

* `zoneName`
* `queryLogsLogGroupArn`
* `vpcs`（Private Hosted Zone のとき）

#### `ARecord`

* `zone`
* `target`
* `recordName`
* `ttl`
* `healthCheck`

### 実務での見どころ

* Public / Private Hosted Zone の使い分け
* ALB / CloudFront への Alias
* Query logging

`HostedZone` はドメイン名、クエリログ、関連付け VPC を持ち、`ARecord` は zone・target・record 名・TTL・health check を中心に設定します。CloudFront Alias には `CloudFrontTarget` を使います。([AWS ドキュメント][6])

---

# 3. API / 認証 / モダン化寄り 🔐

## 3-1. `lambda.Function` ✅ 優先度高

### これを足したい理由

運用のマネージドサービス化資料では、**15分以内で収まる処理は Lambda が推奨**です。今の4ファイルには Lambda がなく、ここは GCAS のモダン化寄り差分としてかなり大きいです。

### 主要 props

* `code`
* `handler`
* `runtime`
* `memorySize`
* `timeout`
* `environment`
* `environmentEncryption`
* `vpc`
* `allowAllOutbound`
* `securityGroups`
* `logGroup`
* `tracing`

### 実務での見どころ

* API の軽いバックエンド
* バッチの一部置き換え
* S3 / EventBridge / SQS トリガー

`Function` は、コード・ハンドラ・ランタイムに加えて、ネットワーク、環境変数、暗号化、ログ、メモリ、タイムアウトなどを設定できます。([AWS ドキュメント][7])

---

## 3-2. `apigateway.RestApi` または `apigatewayv2.HttpApi` ✅ 優先度高

### これを足したい理由

GCAS のリファレンスアーキテクチャでは、**API Gateway + Cognito + Lambda** の形が頻出です。今は ALB ベース中心なので、**Web API アーキテクチャの学習差分**として入れる価値が大きいです。

### 主要 props

#### `RestApi`

* `restApiName`
* `cloudWatchRole`
* `deployOptions`
* `defaultCorsPreflightOptions`
* `endpointConfiguration`
* `domainName`
* `policy`

#### `HttpApi`

* `apiName`
* `corsPreflight`
* `createDefaultStage`
* `defaultIntegration`
* `defaultAuthorizer`
* `disableExecuteApiEndpoint`

### 使い分け

* **まずは `RestApi`**
  Authorizer / Usage Plan / Resource-Method モデルを学びやすい
* **軽量に始めるなら `HttpApi`**
  ルーティングがシンプル

`RestApi` は API 名、CloudWatch ロール、デプロイ設定などを持ち、`HttpApi` は CORS・デフォルト統合・デフォルト認可・ステージ生成などを持ちます。([AWS ドキュメント][8])

---

## 3-3. `cognito.UserPool` ✅ 優先度高

### これを足したい理由

GCAS の参考構成では、**利用者向けトークン発行や API Authorizer の前段**として Cognito がよく出ます。今の stack は IAM ロールはあるけれど、**エンドユーザー認証基盤**が未登場です。

### 主要 props

* `selfSignUpEnabled`
* `signInAliases`
* `autoVerify`
* `passwordPolicy`
* `mfa`
* `accountRecovery`
* `deletionProtection`
* `lambdaTriggers`
* `standardAttributes`
* `userPoolName`

### 補足

実務ではほぼセットで **`UserPoolClient`** も使います。
学習順としては **`UserPool` → `UserPoolClient` → API Gateway Authorizer** が素直です。

`UserPool` はサインイン属性、自動検証、MFA、パスワードポリシー、アカウント復旧、Lambda トリガーなどを持ちます。([AWS ドキュメント][9])

---

# 4. データ / 状態外出し 🗄️

## 4-1. `dynamodb.Table` ✅ 優先度高

### これを足したい理由

Replatform 資料では、オートスケール前提なら **セッション情報はサーバ外に保持**すべきで、候補として **DynamoDB / ElastiCache / RDS / MemoryDB** が挙がっています。今の stack には DynamoDB がありません。

### 主要 props

* `partitionKey`
* `sortKey`
* `billingMode`
* `encryption`
* `encryptionKey`
* `pointInTimeRecovery`
* `replicationRegions`
* `stream`
* `timeToLiveAttribute`
* `tableName`
* `removalPolicy`

### 実務での見どころ

* セッション保存
* ステートレス化
* DR を意識した Global Table 学習

`Table` はキー設計、課金モード、暗号化、PITR、レプリケーション、TTL、ストリームなどを持ちます。([AWS ドキュメント][10])

---

## 4-2. `docdb.DatabaseCluster` ✅ 次点だが重要

### これを足したい理由

GCAS の参考構成では、ユーザー情報や半構造化データ系で **DocumentDB** が使われています。今の4ファイルは **RDS/Aurora 寄り**なので、NoSQL/ドキュメント寄り DB の練習枠として差分があります。

### 主要 props

* `masterUser`
* `vpc`
* `vpcSubnets`
* `instanceType`
* `instances`
* `kmsKey`
* `backup`
* `deletionProtection`
* `exportAuditLogsToCloudWatch`
* `securityGroup`

`DatabaseCluster` は管理ユーザー、VPC/サブネット、インスタンスタイプ、バックアップ、削除保護、KMS、監査ログ出力などを持ちます。([AWS ドキュメント][11])

---

## 4-3. `elasticache.CfnReplicationGroup` ✅ 次点

### これを足したい理由

同じく Replatform 資料で、**セッション外出し**候補に ElastiCache が入っています。
**低レイテンシなセッション / キャッシュ / 一時状態**を扱う学習としては、DynamoDB と並べて押さえる価値があります。

### 主要 props

* `replicationGroupDescription`
* `engine`
* `engineVersion`
* `cacheNodeType`
* `cacheSubnetGroupName`
* `securityGroupIds`
* `automaticFailoverEnabled`
* `multiAzEnabled`
* `atRestEncryptionEnabled`
* `transitEncryptionEnabled`
* `kmsKeyId`
* `snapshotRetentionLimit`

`CfnReplicationGroup` は、エンジン、ノードサイズ、サブネット、SG、フェイルオーバー、Multi-AZ、暗号化、スナップショット保持などを持ちます。([AWS ドキュメント][12])

---

# 5. 非同期 / ジョブ / イベント 🔁

## 5-1. `scheduler.CfnSchedule` ✅ 優先度高

### これを足したい理由

GCAS の運用マネージド化資料では、**スケジューラーは EventBridge Scheduler 推奨**です。今の stack には定期ジョブや起動停止スケジュールの Construct がありません。

### 主要 props

* `scheduleExpression`
* `flexibleTimeWindow`
* `target`
* `groupName`
* `scheduleExpressionTimezone`
* `startDate`
* `endDate`
* `state`
* `kmsKeyArn`

### 実務での見どころ

* 検証環境の **自動停止**
* 定期バッチ起動
* メンテ時間の制御

`CfnSchedule` は、実行式、柔軟時間窓、ターゲット、タイムゾーン、開始/終了、状態などを持つ L1 です。([AWS ドキュメント][13])

---

## 5-2. `stepfunctions.StateMachine` ✅ 優先度高

### これを足したい理由

GCAS では、**ETL 以外のジョブオーケストレーターは Step Functions が有力**と整理されています。繰り返し・条件分岐・並列実行・エラー処理が必要なときに効きます。

### 主要 props

* `definitionBody`
* `definitionSubstitutions`
* `logs`
* `role`
* `stateMachineType`
* `timeout`
* `tracingEnabled`
* `encryptionConfiguration`
* `stateMachineName`

`StateMachine` は、定義本体、ログ、IAM ロール、タイプ、タイムアウト、トレーシング、暗号化設定を持ちます。([AWS ドキュメント][14])

---

## 5-3. `sqs.Queue` / `sns.Topic` ✅ 優先度高

### これを足したい理由

イベントドリブン化資料では、EventBridge Pipes の接続先/接続元として **SQS / SNS / Lambda / Step Functions / API Gateway** が並びます。今の stack は同期呼び出し寄りです。

### `sqs.Queue` の主要 props

* `deadLetterQueue`
* `visibilityTimeout`
* `retentionPeriod`
* `encryption`
* `encryptionMasterKey`
* `fifo`
* `queueName`
* `receiveMessageWaitTime`
* `enforceSSL`

### `sns.Topic` の主要 props

* `displayName`
* `fifo`
* `masterKey`
* `enforceSSL`
* `topicName`
* `loggingConfigs`
* `tracingConfig`

### 使い分け

* **SQS**: バッファ / 再試行 / 非同期ワークキュー
* **SNS**: ファンアウト通知 / 複数購読先

`Queue` は DLQ・可視性タイムアウト・保持期間・暗号化・FIFO などを持ち、`Topic` は表示名・FIFO・KMS・SSL 強制・ログ/トレース設定などを持ちます。([AWS ドキュメント][15])

---

# 6. ガバナンス / 監査 / 構成記録 🛡️

## 6-1. `cloudtrail.Trail` ✅ 優先度高

### これを足したい理由

今の4ファイルには **操作監査の土台**がありません。ガバメントクラウド案件の実務感を出すなら、ここはかなり大きい差分です。

### 主要 props

* `bucket`
* `cloudWatchLogGroup`
* `cloudWatchLogsRetention`
* `enableFileValidation`
* `encryptionKey`
* `includeGlobalServiceEvents`
* `isMultiRegionTrail`
* `sendToCloudWatchLogs`
* `snsTopic`
* `trailName`

`Trail` は S3 出力、CloudWatch Logs 連携、保持期間、ファイル検証、KMS、Multi-Region、SNS 通知などを持ちます。([AWS ドキュメント][16])

---

## 6-2. `config.CfnConfigurationRecorder` + `config.CfnDeliveryChannel` ✅ 優先度高

### これを足したい理由

**変更の記録**と **設定逸脱の土台**として重要です。
今の stack はリソースを作るところまではあるが、**記録する側**が未登場です。

### `CfnConfigurationRecorder` の主要 props

* `roleArn`
* `name`
* `recordingGroup`
* `recordingMode`

### `CfnDeliveryChannel` の主要 props

* `s3BucketName`
* `s3KeyPrefix`
* `s3KmsKeyArn`
* `snsTopicArn`
* `configSnapshotDeliveryProperties`

AWS Config は、**Recorder と DeliveryChannel の両方が必要**です。`ConfigurationRecorder` は記録対象/頻度、`DeliveryChannel` は S3/SNS の配送先を持ちます。([AWS ドキュメント][17])

---

## 6-3. `guardduty.CfnDetector` / `securityhub.CfnHub` ✅ 次点

### これは実務優先度が高いが、案件依存

* **`guardduty.CfnDetector`**

  * 主要 props: `enable`, `features`, `findingPublishingFrequency`
* **`securityhub.CfnHub`**

  * 主要 props: `autoEnableControls`, `controlFindingGenerator`, `enableDefaultStandards`

### 位置づけ

これは **「まずアプリを動かす」より少し後**でもいいですが、
**ガバメントクラウドの運用・統制っぽさ**を出すには早めに見ておきたいです。

`CfnDetector` は GuardDuty 有効化と検出機能設定、`CfnHub` は Security Hub 有効化とコントロール/標準設定を持ちます。([AWS ドキュメント][18])

---

# 優先順位をさらに絞るとこうです 🎯

## A. まず次の学習用 stack に入れたい

1. `autoscaling.AutoScalingGroup`
2. `backup.BackupPlan`
3. `cloudtrail.Trail`
4. `config.CfnConfigurationRecorder` + `config.CfnDeliveryChannel`
5. `certificatemanager.Certificate`
6. `route53.HostedZone` + `route53.ARecord`

## B. その次

7. `cloudfront.Distribution`
8. `lambda.Function`
9. `apigateway.RestApi`
10. `cognito.UserPool`
11. `dynamodb.Table`
12. `scheduler.CfnSchedule`
13. `stepfunctions.StateMachine`
14. `sqs.Queue` / `sns.Topic`

## C. Windows リプレイス色を強めるなら

15. `fsx.CfnFileSystem`

---

# かなり実務寄りに言うと 🧩

**Windows リプレイス案件の練習 stack** として次に増やすなら、順番はこれがいちばん効率いいです。

* **EC2 単体 → `AutoScalingGroup` 化**
* **バックアップ未定義 → `BackupPlan` 追加**
* **DNS/証明書なし → `Certificate` + `Route53`**
* **監査なし → `Trail` + `Config`**
* **共有ファイルがありそうなら → `FSx`**
* **モダン化の練習を混ぜるなら → `Lambda` + `API Gateway` + `Cognito` + `DynamoDB`**

ここまで入ると、今の stack 群よりかなり **GCAS 実務の会話に寄ります**。

[1]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_autoscaling.AutoScalingGroup.html "class AutoScalingGroup (construct) · AWS CDK"
[2]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_backup.BackupPlan.html "class BackupPlan (construct) · AWS CDK"
[3]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_fsx.CfnFileSystem.html "class CfnFileSystem (construct) · AWS CDK"
[4]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.Distribution.html "class Distribution (construct) · AWS CDK"
[5]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.Certificate.html "class Certificate (construct) · AWS CDK"
[6]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53.HostedZone.html "class HostedZone (construct) · AWS CDK"
[7]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.Function.html "class Function (construct) · AWS CDK"
[8]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.RestApi.html "class RestApi (construct) · AWS CDK"
[9]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito.UserPool.html "class UserPool (construct) · AWS CDK"
[10]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.Table.html "class Table (construct) · AWS CDK"
[11]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_docdb.DatabaseCluster.html "class DatabaseCluster (construct) · AWS CDK"
[12]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_elasticache.CfnReplicationGroup.html "class CfnReplicationGroup (construct) · AWS CDK"
[13]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_scheduler.CfnSchedule.html "class CfnSchedule (construct) · AWS CDK"
[14]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions.StateMachine.html "class StateMachine (construct) · AWS CDK"
[15]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html "class Queue (construct) · AWS CDK"
[16]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudtrail.Trail.html "class Trail (construct) · AWS CDK"
[17]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_config.CfnConfigurationRecorder.html "class CfnConfigurationRecorder (construct) · AWS CDK"
[18]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_guardduty.CfnDetector.html "class CfnDetector (construct) · AWS CDK"
