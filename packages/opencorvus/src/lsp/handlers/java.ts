import { spawn, path, $, os, Global, Filesystem, Flag, NearestRoot, pathExists, which, log, fs } from "../shared"
import type { Info } from "../shared"

export const JDTLS: Info = {
  id: "jdtls",
  root: NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"]),
  extensions: [".java"],
  async spawn(root) {
    const java = which("java")
    if (!java) {
      log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
      return
    }
    const javaMajorVersion = await $`java -version`
      .quiet()
      .nothrow()
      .then(({ stderr }) => {
        const m = /"(\d+)\.\d+\.\d+"/.exec(stderr.toString())
        return !m ? undefined : parseInt(m[1])
      })
    if (javaMajorVersion == null || javaMajorVersion < 21) {
      log.error("JDTLS requires at least Java 21.")
      return
    }
    const distPath = path.join(Global.Path.bin, "jdtls")
    const launcherDir = path.join(distPath, "plugins")
    const installed = await pathExists(launcherDir)
    if (!installed) {
      if (Flag.OPENCORVUS_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading JDTLS LSP server.")
      await fs.mkdir(distPath, { recursive: true })
      const releaseURL =
        "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
      const archiveName = "release.tar.gz"

      log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
      const curlResult = await $`curl -L -o ${archiveName} '${releaseURL}'`.cwd(distPath).quiet().nothrow()
      if (curlResult.exitCode !== 0) {
        log.error("Failed to download JDTLS", { exitCode: curlResult.exitCode, stderr: curlResult.stderr.toString() })
        return
      }

      log.info("Extracting JDTLS archive")
      const tarResult = await $`tar -xzf ${archiveName}`.cwd(distPath).quiet().nothrow()
      if (tarResult.exitCode !== 0) {
        log.error("Failed to extract JDTLS", { exitCode: tarResult.exitCode, stderr: tarResult.stderr.toString() })
        return
      }

      await fs.rm(path.join(distPath, archiveName), { force: true })
      log.info("JDTLS download and extraction completed")
    }
    const jarFileName = await $`ls org.eclipse.equinox.launcher_*.jar`
      .cwd(launcherDir)
      .quiet()
      .nothrow()
      .then(({ stdout }) => stdout.toString().trim())
    const launcherJar = path.join(launcherDir, jarFileName)
    if (!(await pathExists(launcherJar))) {
      log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
      return
    }
    const configFile = path.join(
      distPath,
      (() => {
        switch (process.platform) {
          case "darwin":
            return "config_mac"
          case "linux":
            return "config_linux"
          case "win32":
            return "config_win"
          default:
            return "config_linux"
        }
      })(),
    )
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-jdtls-data"))
    return {
      process: spawn(
        java,
        [
          "-jar",
          launcherJar,
          "-configuration",
          configFile,
          "-data",
          dataDir,
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "--add-modules=ALL-SYSTEM",
          "--add-opens java.base/java.util=ALL-UNNAMED",
          "--add-opens java.base/java.lang=ALL-UNNAMED",
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}
