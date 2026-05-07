const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://opencorvus.dev" : `https://${stage}.opencorvus.dev`,
  console: stage === "production" ? "https://opencorvus.dev/auth" : `https://${stage}.opencorvus.dev/auth`,
  email: "yangheng2021@gmail.com",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/yangheng95/argus",
  discord: "https://github.com/yangheng95/argus/discussions",
  headerLinks: [],
}
