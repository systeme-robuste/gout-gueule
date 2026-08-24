# Telegram Login

Goût Gueule uses the official legacy Telegram Login Widget with `@XMonsieurBot` because it does not require an OIDC Client ID or Secret. The server validates the widget payload using Telegram’s documented HMAC-SHA-256 algorithm (SHA-256 of `TELEGRAM_BOT_TOKEN` as the secret) and rejects payloads older than 24 hours.

Required Render environment variable: `TELEGRAM_BOT_TOKEN`. The domain `https://gout-gueule-fcvr.onrender.com` must remain registered in BotFather under the bot’s allowed URLs.

Telegram users are stored in the existing `users` collection with `telegramId`, display name, username, and photo URL, and receive the existing session. Followers use the stable Telegram user ID while anonymous reading, likes, and sharing remain available. Comments continue to require a signed-in account.

Email login is not added in this change: there is no verified, safely configured sender/verification flow in the current deployment.
