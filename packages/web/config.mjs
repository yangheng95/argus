const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://opencorvus.ai" : `https://${stage}.opencorvus.ai`,
  console: stage === "production" ? "https://opencorvus.ai/auth" : `https://${stage}.opencorvus.ai/auth`,
  email: "yangheng2021@gmail.com",
  github: "https://github.com/yangheng95/opencorvus",
  repository: "https://git-cc.myhexin.com:6443/yangheng/opencorvus",
  discord: "https://github.com/yangheng95/opencorvus/discussions",
  headerLinks: [],
}
