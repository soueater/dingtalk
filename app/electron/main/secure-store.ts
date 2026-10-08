// electron/main/secure-store.ts
// API 密钥的加密存取：safeStorage 不可用时降级为「混淆存储 + 明示告警」
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const FILE = 'secrets.enc'
const FALLBACK_FILE = 'secrets.plain'

function filePath(name: string) {
  return path.join(app.getPath('userData'), name)
}

interface SecretMap {
  [configId: string]: string
}

function readMap(): SecretMap {
  try {
    // 优先读取加密文件
    const enc = filePath(FILE)
    if (fs.existsSync(enc) && safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(enc)
      const json = safeStorage.decryptString(buf)
      return JSON.parse(json) as SecretMap
    }
    // 降级：混淆文件
    const plain = filePath(FALLBACK_FILE)
    if (fs.existsSync(plain)) {
      const raw = fs.readFileSync(plain, 'utf8')
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as SecretMap
    }
    return {}
  } catch {
    return {}
  }
}

function writeMap(map: SecretMap) {
  const json = JSON.stringify(map)
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(json)
    fs.writeFileSync(filePath(FILE), buf)
    // 清理可能存在的降级文件
    const plain = filePath(FALLBACK_FILE)
    if (fs.existsSync(plain)) fs.unlinkSync(plain)
  } else {
    // 降级：base64 混淆（非加密！仅避免明文肉眼可见）
    fs.writeFileSync(filePath(FALLBACK_FILE), Buffer.from(json, 'utf8').toString('base64'))
  }
}

export const secureStore = {
  /** 保存某配置的密钥 */
  set(configId: string, apiKey: string) {
    const map = readMap()
    map[configId] = apiKey
    writeMap(map)
  },
  /** 读取密钥（仅主进程可用） */
  get(configId: string): string | undefined {
    return readMap()[configId]
  },
  /** 删除密钥 */
  remove(configId: string) {
    const map = readMap()
    delete map[configId]
    writeMap(map)
  },
  /** 是否处于加密可用状态 */
  isEncrypted(): boolean {
    return safeStorage.isEncryptionAvailable()
  },
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}
