import { notFound } from 'next/navigation'

// 未知地址使用认证根布局的中文错误页，不依赖实验性的全局 404。
export default function UnmatchedPage() {
  notFound()
}
