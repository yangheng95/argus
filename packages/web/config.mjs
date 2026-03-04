const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://opencorvus.ai" : `https://${stage}.opencorvus.ai`,
  console: stage === "production" ? "https://opencorvus.ai/auth" : `https://${stage}.opencorvus.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/yangheng95/opencorvus",
  discord: "https://opencorvus.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
