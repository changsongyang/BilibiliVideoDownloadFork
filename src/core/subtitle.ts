import { randUserAgent } from '../utils'
import { Subtitle } from '../type'

const got = require('got')
const fs = require('fs-extra')

export const downloadSubtitle = (fileName: string, list: Subtitle[]) => {
  const plist = []
  for (const element of list) {
    plist.push(
      getSubtitleData(element.url, `${fileName}-${element.title}.srt`)
    )
  }
  return Promise.all(plist)
}

const getSubtitleData = async (url: string, path: string) => {
  // console.log('[main-got]: getSubtitleData ---> ', url)
  const { body: { body } } = await got(`https:${url}`, {
    headers: {
      'User-Agent': randUserAgent()
    },
    responseType: 'json'
  })
  const str = handleSubtitleData(body)
  await createFile(path, str)
}

const handleSubtitleData = (subtitle: any[]) => {
  let str = ''
  subtitle.forEach((element, index) => {
    const form = String(element.from).split('.')
    const to = String(element.to).split('.')
    str += `${index + 1}\n${formatSeconds(Number(form[0]))},${form[1] ? form[1] : '0'} --> ${formatSeconds(Number(to[0]))},${to[1] ? to[1] : '0'}\n${element.content}\n\n`
  })
  return str
}

const formatSeconds = (value: number) => {
  const result = Math.floor(value)
  const h = Math.floor(result / 3600) < 10 ? '0' + Math.floor(result / 3600) : Math.floor(result / 3600)
  const m = Math.floor((result / 60 % 60)) < 10 ? '0' + Math.floor((result / 60 % 60)) : Math.floor((result / 60 % 60))
  const s = Math.floor((result % 60)) < 10 ? '0' + Math.floor((result % 60)) : Math.floor((result % 60))
  let res = ''
  res += `${h}:`
  res += `${m}:`
  res += `${s}`
  return res
}

const createFile = async (path: string, data: string) => {
  try {
    await fs.writeFile(path, data, { encoding: 'utf8' })
    console.log('success')
  } catch (err) {
    console.error('写入文件失败:', err)
  }
}
