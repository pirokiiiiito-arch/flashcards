# Drive の長期接続 — 準備ブランチ（未公開・未切替）

## 現在の到達点

このブランチはサーバー側の認証更新処理とそのテストを準備するものです。
**本番の3アプリは変更していません。自動ログインが有効になったわけではありません。**
SQLは未適用、Edge Functionは未デプロイです。Google実アカウントでの認可・更新テストも未実施です。

- `broker.mjs`: 認可コード + PKCE、本人照合、Google更新トークンによる自動更新。
- `index.ts`: Supabaseの本人確認と、サーバー専用RPCを使用する実行用アダプター。
- `schema.sql`: Vault暗号化保存、非公開テーブル、サーバー専用RPCの追加DDL。
- `broker.test.mjs`: 実際のGoogleに通信しない合成データによるテスト。

## 完成時の動作

単語・植物・色名の各端末で最初にアプリへログインし、所有者がGoogle Driveの継続利用を一度許可する。
以後は端末のアプリログインとGoogleの短期認証を内部で更新し、登録・保存から自動送信、閲覧中は差分を自動受信する。
ページを再び開くと、保存済みカード・写真を先に表示し、自動で差分同期する。
Googleの許可取消しやアプリのログイン無効化など、更新不能な場合だけ本人確認を求める。
通信断・サーバー障害を認証切れと混同せず、名前・写真・送信待ちを消さない。
閉じたスマホブラウザを動かし続ける方式ではなく、次に開いたときに追いつく。

## 管理者が一度だけ行う設定

既存のOAuthクライアントを使用する。別のGoogleプロジェクトへ作り直さない。
既存ID:
`549199582878-b5aflr2vli7lqnfa0nhge6994qfbeh2s.apps.googleusercontent.com`

1. Google Cloudの当該クライアントで、承認済みリダイレクトURIに以下を追加する。
   `https://pirokiiiiito-arch.github.io/flashcards/drive-login.html`
   このコールバック画面は現時点ではまだ未公開。公開確認までは認可フローを開始しない。
2. そのクライアントのクライアントシークレットを、Supabase Vaultに
   **名前 `flashcards_google_client_secret`** として登録する。
   値をChatGPT、Gmail、GitHub、ブラウザのJS、URLへ貼らない。
3. Google側の同意画面・テスト/公開状態・利用ユーザー設定を確認する。
   その実設定に応じた再認証条件を確認するまで「永久に再認証不要」と約束しない。

設定先:
- Google Cloud: https://console.cloud.google.com/apis/credentials
- Supabase: https://supabase.com/dashboard/project/himtyybslzzwsfmgdivx
  プロジェクトのVault（Secrets）で上記の名前を使用する。
- Vaultの公式説明: https://supabase.com/docs/guides/database/vault

## 切替前に必要な残作業（未完了）

- 上記管理設定の確認。シークレット値は返さず登録の有無だけを確認。
- `schema.sql` の権限・RLS・RPCを実DBで検証し適用。セキュリティアドバイザー確認。
- `drive-auth` Edge Functionをデプロイ。`verify_jwt=false` を使用する場合も、
  `/status`とOPTIONS以外はこの実装の`/auth/v1/user`本人確認を必須にする。
- アプリログインの復元/自動更新を3アプリに組み込む。旧Supabaseセッションの有効期限切れ、
  複数タブの更新競合、保存領域が使えない場合を検証する。Google refresh tokenはクライアントへ渡さない。
- `drive-login.html` コールバックとログイン画面を実装。state/verifierを一時保存し、使用後に除去。
  callback URL内のcodeは処理後履歴から除去する。未保存の編集を遷移で破棄しない。
- 編集用`drive-core.js`、植物専用生成コア、閲覧用生成コアの短期トークン更新を接続。
  既存のアカウントID照合・保存済み写真・差分履歴を維持する。
- リフレッシュ成功、実際の期限切れ、再読み込み、切断、複数タブ、iPhoneを検証。
- 旧方式へ戻せる状態を保ち、テスト成功後に3アプリを切替。

## API（準備中）

Originは公開カードの同一Originだけを許可。POSTはJSON。
すべてのPOSTでSupabaseユーザーのBearer JWTを検証し、ownerは検証したuser.idから得る。
クライアントが指定するowner_idは利用しない。

- GET `/status`: 設定の有無のみ。秘密鍵を返さない。
- POST `/start`: `code_challenge`, `expected_account`（既存Drive permissionId、任意）。認可URLとstateを返す。
- POST `/exchange`: `code`, `state`, `code_verifier`。Google本人とアプリ本人のメール一致、Driveアカウント一致を確認。
- POST `/token`: 期限内の短期トークンを再利用し、必要ならサーバーで更新。
- POST `/disconnect`: 明示的ログアウト時のみ使用。接続用資格情報を削除するが写真・カードには触れない。

更新トークンはVaultに暗号化して保持。サーバー専用RPCはPUBLIC/anon/authenticatedの実行権を剥奪。
HTTP応答・例外・ログへ更新トークン、シークレット、パスワードを出さない。
短期アクセストークンだけが本人の端末へ返され、端末ではメモリー内のみで使う。

## テスト

`node --test server/drive-auth/broker.test.mjs`

このテストの成功はサーバーの制御ロジックの確認であり、Google側の設定完了・実ユーザーの
永続ログイン・本番サイト公開の成功を意味しない。
