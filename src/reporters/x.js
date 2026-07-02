const { TwitterApi } = require('twitter-api-v2');

function makeTwitterClient() {
  const keys = {
    appKey: (process.env.X_APP_KEY || '').trim(),
    appSecret: (process.env.X_APP_SECRET || '').trim(),
    accessToken: (process.env.X_ACCESS_TOKEN || '').trim(),
    accessSecret: (process.env.X_ACCESS_SECRET || '').trim(),
  };
  return Object.values(keys).every(Boolean) ? new TwitterApi(keys) : null;
}

async function postToX(client, text) {
  if (!client) return null;
  const res = await client.v2.tweet({ text: String(text || '').slice(0, 275) });
  return res?.data?.id || null;
}
async function replyToX(client, text, id) {
  if (!client || !id) return null;
  const res = await client.v2.tweet({ text: String(text || '').slice(0, 275), reply: { in_reply_to_tweet_id: id } });
  return res?.data?.id || null;
}

module.exports = { makeTwitterClient, postToX, replyToX };
