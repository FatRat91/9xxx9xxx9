## 結論 🎯

自己学習で **CDK v2(TypeScript)** を回す前提なら、優先順位はこうです。

### 第一候補

**GitHub + GitHub Actions**
→ いちばん学習効率が高いです。
理由は、**PR・必須チェック・承認・通知・依存関係更新・コードスキャン**まで、1つの場所で完結しやすいからです。GitHub は保護ブランチで **承認レビュー** と **必須ステータスチェック** を要求でき、GitHub Actions は AWS へ **OIDC** で接続できます。 ([GitHub Docs][1])

### 第二候補

**GitHub + CodePipeline**
→ **GitHubでレビュー文化**を学びつつ、**AWSネイティブなデプロイ**にも寄せられます。GitHub は CodePipeline のソースにでき、GitHub 側でPR承認、AWS 側で本番前の手動承認を入れる構成が取りやすいです。 ([AWS ドキュメント][2])

### 第三候補

**CodeCommit + CodePipeline**
→ **AWS閉域寄り / AWSネイティブ寄り**の感触は強いです。
ただし、自己学習のしやすさ、周辺ツール、レビュー体験、転職市場での汎用性では GitHub 系よりやや不利です。CodeCommit には **承認ルール** があり、CodePipeline には **手動承認** があります。 ([AWS ドキュメント][3])

---

# まず前提（GCAS目線）📘

## 事実

GCAS の最新資料では、**アプリのCI/CDはシステム特性に応じて最適化してよい**、**利用ツールにも特段の制限はない**、ただし **特定ベンダー専用に寄りすぎるものは避ける** とされています。いっぽうで、**インフラ部分のCI/CD** は GCAS 指定のツールやテンプレート / IaC ファイルを使うのが基本です。  

## 推論

なので、あなたの今の **自己学習用CDK repo** なら、
**GitHub + GitHub Actions で学ぶのは十分実務的**です。
ただし、**ガバクラ案件のインフラCI/CDそのものを想定**するなら、最終的には **CodePipeline / CodeBuild 側の理解**も持っておいた方が安全です。

---

# どの構成でも共通で入れたい最小チェック ✅

## 1. 整形

* **Prettier**
  CI では `--check` が素直です。Prettier 公式も CI での `--check` 利用を案内しています。 ([Prettier][4])

## 2. 静的解析

* **ESLint**
  `--max-warnings 0` にすると、warning でもCI失敗にできます。ESLint 公式でも `--max-warnings` でエラー終了にできると明記されています。 ([ESLint][5])

## 3. TypeScript整合性

* **`tsc --noEmit`**
  型崩れ検出用。
  これは一般的なTypeScript運用としての推奨で、ここは推論です。

## 4. CDK/IaCチェック

* **`cdk synth`**
  CDKコードが最終的にテンプレート化できるか確認する基本です。
* **cdk-nag**
  AWS Prescriptive Guidance でも、CDKアプリのルール準拠確認に **cdk-nag** を使うことが紹介されています。 ([AWS ドキュメント][6])

## 5. 依存関係の脆弱性

* **`npm audit`**
  npm 公式の依存脆弱性監査です。脆弱性があると影響や修正案が出ます。 ([npmドキュメント][7])

## 6. 追加のセキュリティ / IaCスキャン

* **Checkov**
  CloudFormation を含む IaC の誤設定検出に使えます。CI/CD統合も案内されています。 ([checkov.io][8])
* **Trivy**
  `trivy fs` で repo を対象に **脆弱性 / misconfiguration / secrets / licenses** を見られます。 ([aquasecurity.github.io][9])

## 7. テスト結果の見える化

* **CodeBuild Reports**
  CodeBuild は JUnit XML などのテストレポートを扱えます。 ([AWS ドキュメント][10])
* **GitHub Checks / Actions**
  GitHub 側は PR 上でステータスチェックを必須にできます。 ([GitHub Docs][1])

---

# 構成ごとの整理 🧩

---

## 1) GitHub + GitHub Actions

### いちばん相性が良いツール

* **CI実行**: GitHub Actions
* **整形**: Prettier
* **静的解析**: ESLint
* **型検査**: `tsc --noEmit`
* **CDK/IaC**: `cdk synth`, `cdk-nag`
* **依存脆弱性**: `npm audit`, Dependabot
* **コードスキャン**: GitHub CodeQL
* **承認**: Protected branch + required reviews + required status checks
* **通知**: GitHub for Slack / GitHub for Teams

GitHub は **保護ブランチ** で、**承認レビュー** と **必須ステータスチェック** を要求できます。GitHub CodeQL は default setup で有効化でき、Dependabot はセキュリティ更新PRを自動作成できます。GitHub の Slack / Teams 連携では、PR・レビュー・Actions の通知が扱えます。 ([GitHub Docs][1])

### 実務向けの最小ジョブ構成

* `format`: `prettier --check .`
* `lint`: `eslint . --max-warnings 0`
* `typecheck`: `tsc --noEmit`
* `unit`: `npm test`
* `iac`: `cdk synth`
* `security`: `cdk-nag` + `npm audit`
* 任意追加: `checkov`, `trivy fs`

### 承認の流れ

* PR作成
* Actions が全部走る
* 必須チェック通過
* 1〜2人レビュー承認
* `main` マージ

これは **あなたの今の学習目的** には最も向いています。
理由は、**PR中心の学習**がしやすいからです。これは推論です。

### この構成の弱点

* AWSネイティブな **CodeBuild / CodePipeline / 手動承認** の感触は薄くなります。
* ガバクラの **インフラCI/CDそのもの** を想定すると、少しGitHub寄りに寄りすぎる可能性があります。これは推論です。

---

## 2) GitHub + CodePipeline

### いちばん相性が良いツール

* **Repo / レビュー**: GitHub
* **ソース連携**: CodePipeline + CodeConnections
* **ビルド / テスト**: CodeBuild
* **整形 / lint / synth / nag / audit**: CodeBuild内で実行
* **承認**: GitHub branch protection + CodePipeline manual approval
* **通知**: CodeStar Notifications / SNS / Amazon Q Developer in chat applications（Slack / Teams）

CodePipeline は GitHub を **CodeConnections** 経由でソースにでき、新しいコミットでパイプラインを起動できます。CodePipeline には **手動承認アクション** があり、通知は SNS と組み合わせられます。AWS Developer Tools の通知は Amazon Q Developer in chat applications 経由で Slack / Teams に流せます。 ([AWS ドキュメント][2])

### 実務向けの組み方

#### パターンA

* **PR時の軽量チェック** は GitHub Actions
* **main マージ後の本格CI/CD** は CodePipeline + CodeBuild

これはかなり実務的です。
PRでは速いチェックだけ流し、マージ後にAWS側で本番相当チェックを流せます。
これは推論ですが、現場でよく収まりが良い形です。

#### パターンB

* GitHub は **レビュー専用**
* CI は全部 CodeBuild
* デプロイ前に CodePipeline manual approval

これも実務では普通にあります。
ただし、**PR時に見えるチェック** は GitHub Actions より作り込みが少し面倒です。これは推論です。

### この構成で入れたいチェック

* CodeBuild で

  * `npm ci`
  * `prettier --check`
  * `eslint --max-warnings 0`
  * `tsc --noEmit`
  * `npm test`
  * `cdk synth`
  * `cdk-nag`
  * `npm audit`
  * 任意で `checkov` / `trivy fs`
* テスト結果は CodeBuild Reports に出す ([AWS ドキュメント][10])

### 承認の流れ

* GitHub PR でレビュー承認
* `main` マージ
* CodePipeline 実行
* 検証反映
* 本番前で **Manual Approval**
* 承認後に本番

### この構成の評価

**GitHub文化 + AWSネイティブ運用** のバランスがいいです。
学習としても、**将来ガバクラ案件に寄せる橋渡し**としてかなり優秀です。これは推論です。

---

## 3) CodeCommit + CodePipeline

### いちばん相性が良いツール

* **Repo**: CodeCommit
* **CI/CD**: CodePipeline + CodeBuild
* **整形 / lint / synth / nag / audit**: CodeBuild
* **承認**: CodeCommit approval rules + CodePipeline manual approval
* **通知**: CodeStar Notifications / SNS / Amazon Q Developer in chat applications / CodeCommit trigger -> SNS or Lambda

CodeCommit には **PR承認ルール** があります。CodePipeline には **手動承認** があり、Developer Tools 通知ルールや SNS を使えます。CodeCommit 自体も SNS や Lambda をトリガーできます。 ([AWS ドキュメント][3])

### 入れたいチェック

* CodeBuild で共通セット

  * `prettier --check`
  * `eslint --max-warnings 0`
  * `tsc --noEmit`
  * `npm test`
  * `cdk synth`
  * `cdk-nag`
  * `npm audit`
  * 任意: `checkov`, `trivy fs`

### 承認の流れ

* CodeCommit PR作成
* CodeBuild結果確認
* CodeCommit 承認ルール達成
* マージ
* CodePipeline 実行
* 本番前手動承認

### この構成の評価

**AWS内で閉じやすい**、**CodePipeline/CodeBuild理解が深まる** という利点はあります。
一方で、**GitHubほど周辺ツールやレビュー体験が豊富ではない** ので、自己学習の快適さは落ちやすいです。これは推論です。

---

# カテゴリ別に「どの構成でも使える」実務ツール整理 🛠️

## 整形

* **Prettier**
  最優先。CIでは `--check`。 ([Prettier][4])

## 静的解析

* **ESLint**
  `--max-warnings 0` 推奨。 ([ESLint][5])

## 型チェック

* **TypeScript compiler (`tsc --noEmit`)**
  CDK TS ではかなり重要。
  これは推論です。

## CDK/IaC品質

* **cdk synth**
* **cdk-nag** ([AWS ドキュメント][6])

## 依存関係セキュリティ

* **npm audit** ([npmドキュメント][7])
* **Dependabot**（GitHub系なら特に相性良い） ([GitHub Docs][11])

## コードスキャン

* **GitHub CodeQL**（GitHub系で強い） ([GitHub Docs][12])

## IaC misconfiguration / secrets

* **Checkov** ([checkov.io][8])
* **Trivy fs** ([aquasecurity.github.io][9])

## 承認

* **GitHub**: protected branch / required reviews / required checks ([GitHub Docs][1])
* **CodeCommit**: approval rules ([AWS ドキュメント][3])
* **CodePipeline**: manual approval action ([AWS ドキュメント][13])

## 通知

* **GitHub Slack integration**: PR / issue / review 通知 ([GitHub][14])
* **GitHub for Teams**: PR / Actions / reminders ([GitHub Docs][15])
* **AWS側通知**: CodeStar Notifications + SNS + Amazon Q Developer in chat applications (Slack / Teams) ([AWS ドキュメント][16])

---

# あなた向けのおすすめ構成 🧭

## 学習効率最優先

### **GitHub + GitHub Actions**

* いちばん早く回る
* PR駆動に慣れやすい
* Copilot / CodeQL / Dependabot までつなぎやすい
* 転職市場でも説明しやすい

## ガバクラ寄りの実務感も欲しい

### **GitHub + CodePipeline**

* GitHub のレビュー文化を維持
* AWSネイティブなパイプラインも学べる
* 将来の案件に寄せやすい

## AWS閉域寄りの感触を優先

### **CodeCommit + CodePipeline**

* AWSサービス理解は深まる
* ただし自己学習の快適さは少し落ちる

---

# いちばん現実的な最小セット ✨

あなたの今の段階なら、まずはこれで十分です。

## 第一段階

**GitHub + GitHub Actions**

* `prettier --check`
* `eslint --max-warnings 0`
* `tsc --noEmit`
* `npm test`
* `cdk synth`
* `cdk-nag`
* `npm audit`
* PR必須チェック
* 1人承認で main マージ

## 第二段階

その後に
**GitHub + CodePipeline**

* `main` マージ後に CodeBuild で再チェック
* 検証環境デプロイ
* 本番前 manual approval
* Slack / Teams 通知

この2段階が、**学習効率** と **ガバクラ実務寄せ** のバランスがかなり良いです。
これは推論です。

---

# かなり率直なおすすめ ✂️

今のあなたなら、最初から **CodeCommit + CodePipeline** に寄せ切る必要はありません。
先に **GitHub + GitHub Actions** で、

* PR
* 必須チェック
* 承認
* マージ

の流れを身体で覚えて、
その次に **CodePipeline の manual approval / CodeBuild / SNS通知** を足す方が、理解が分断されにくいです。
GCAS もアプリCI/CDはシステム最適化を認めていますし、インフラCI/CDは別途 GCAS 指定物を意識すべき、という整理です。  

必要なら次に、
**CDK v2(TypeScript) 学習用 repo 向けの、最小 `.github/workflows/ci.yml` と、将来の `buildspec.yml` / CodePipeline 構成案** をそのまま使える形で出します。

[1]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule?utm_source=chatgpt.com "Managing a branch protection rule"
[2]: https://docs.aws.amazon.com/ja_jp/codepipeline/latest/userguide/action-reference-CodestarConnectionSource.html?utm_source=chatgpt.com "GitHub Enterprise Server、GitLab.com、および GitLab セルフ ..."
[3]: https://docs.aws.amazon.com/ja_jp/codecommit/latest/userguide/how-to-create-pull-request-approval-rule.html?utm_source=chatgpt.com "プルリクエストの承認ルールを作成する - AWS CodeCommit"
[4]: https://prettier.io/docs/options?utm_source=chatgpt.com "Options - Prettier"
[5]: https://eslint.org/docs/latest/use/command-line-interface?utm_source=chatgpt.com "Command Line Interface Reference"
[6]: https://docs.aws.amazon.com/ja_jp/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/security-formatting-best-practices.html?utm_source=chatgpt.com "セキュリティの脆弱性やフォーマットエラーのスキャン"
[7]: https://docs.npmjs.com/cli/v9/commands/npm-audit?utm_source=chatgpt.com "npm-audit - Run a security audit"
[8]: https://www.checkov.io/?utm_source=chatgpt.com "checkov"
[9]: https://aquasecurity.github.io/trivy/v0.59/docs/target/filesystem/?utm_source=chatgpt.com "Filesystem"
[10]: https://docs.aws.amazon.com/ja_jp/codebuild/latest/userguide/test-reporting.html?utm_source=chatgpt.com "でレポートをテストする AWS CodeBuild"
[11]: https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependabot-pull-requests?utm_source=chatgpt.com "About Dependabot pull requests"
[12]: https://docs.github.com/en/code-security/how-tos/scan-code-for-vulnerabilities/configure-code-scanning/configuring-default-setup-for-code-scanning?utm_source=chatgpt.com "Configuring default setup for code scanning"
[13]: https://docs.aws.amazon.com/codepipeline/latest/userguide/approvals-action-add.html?utm_source=chatgpt.com "Add a manual approval action to a pipeline in CodePipeline"
[14]: https://github.com/integrations/slack?utm_source=chatgpt.com "integrations/slack: Bring your code to the conversations ..."
[15]: https://docs.github.com/ja/enterprise-server%403.14/integrations/how-tos/teams/customize-notifications?utm_source=chatgpt.com "Customizing notifications for GitHub in Teams"
[16]: https://docs.aws.amazon.com/ja_jp/dtconsole/latest/userguide/notification-rule-create.html?utm_source=chatgpt.com "通知ルールの作成 - デベロッパーツールコンソール"
