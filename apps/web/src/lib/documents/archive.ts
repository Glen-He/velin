import { fromBuffer } from 'yauzl'
import { attachmentLimits } from '@velin/contracts/attachments'

// 逐条流式核实实际解压字节，不能只相信 ZIP 目录声明，也不把解压结果积存在内存。
export function validateArchive(bytes: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) {
          reject(new Error('文档压缩结构无效。'))
          return
        }
        let entries = 0
        let declared = 0
        let actual = 0
        let finished = false
        const fail = () => {
          if (finished) return
          finished = true
          archive.close()
          reject(new Error('文档解压内容过大或压缩结构无效，请精简后重试。'))
        }
        archive.on('error', fail)
        archive.on('end', () => {
          if (!finished) {
            finished = true
            resolve()
          }
        })
        archive.on('entry', (entry) => {
          entries += 1
          declared += entry.uncompressedSize
          if (
            entries > attachmentLimits.archiveEntries ||
            declared > attachmentLimits.archiveBytes ||
            entry.uncompressedSize > attachmentLimits.archiveEntryBytes ||
            entry.isEncrypted()
          ) {
            fail()
            return
          }
          archive.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail()
              return
            }
            let entryBytes = 0
            stream.on('data', (chunk: Buffer) => {
              actual += chunk.length
              entryBytes += chunk.length
              if (
                actual > attachmentLimits.archiveBytes ||
                entryBytes > attachmentLimits.archiveEntryBytes
              ) {
                stream.destroy()
                fail()
              }
            })
            stream.on('error', fail)
            stream.on('end', () => {
              if (!finished) archive.readEntry()
            })
          })
        })
        archive.readEntry()
      },
    )
  })
}
