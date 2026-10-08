// src/components/overlays/HelpModal.tsx —— 使用说明
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useUiStore } from '@/stores/ui.store'
import { APP_NAME, APP_VERSION } from '@shared/version'

export function HelpModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const open = overlay === 'help'

  return (
    <Modal
      open={open}
      title="使用说明"
      subtitle={`${APP_NAME} v${APP_VERSION} · 本地优先的 AI 原型设计工具`}
      width={640}
      onClose={closeOverlay}
      footer={
        <>
          <span className="field-hint" style={{ margin: 0 }}>
            {APP_NAME} v{APP_VERSION}
          </span>
          <div className="flex-1" />
          <Button variant="primary" onClick={closeOverlay}>
            知道了
          </Button>
        </>
      }
    >
      <div className="modal-body">
        <div className="guide-card" style={{ marginBottom: 12 }}>
          <h4>第一步：配置模型</h4>
          <p>
            点击顶栏右侧的模型名称，或按 <code>Ctrl+,</code> 打开配置面板。选择服务商、填入 API 密钥、点击
            「测试连接」确认可用，然后保存。密钥仅保存在本机，加密写入本地文件。
          </p>
          <p style={{ marginTop: 6 }}>
            没有 API 密钥也可以使用：在左侧「AI 生成」页签下方有两个示例项目，直接点击即可体验编辑、预览与导出。
          </p>
        </div>

        <div className="guide-card" style={{ marginBottom: 12 }}>
          <h4>第二步：描述你要的产品</h4>
          <p>
            在左侧输入框用自然语言描述，例如「一个咖啡点单小程序，包含菜单、商品详情、订单确认三个页面」。
          </p>
          <p style={{ marginTop: 6 }}>
            如果描述比较简短，先点「增强提示词」（<code>Ctrl+K</code>），系统会把口语化描述改写为结构化需求，
            显著提升生成稳定性。增强结果可以复制、重新生成，也可以切换回使用原始描述。
          </p>
          <p style={{ marginTop: 6 }}>
            按 <code>Ctrl+Enter</code> 开始生成。生成分三步：规划页面结构 → 定稿设计规范 → 逐页生成。
          </p>
        </div>

        <div className="guide-card" style={{ marginBottom: 12 }}>
          <h4>第三步：编辑</h4>
          <ul>
            <li>点击画布上的任意元素即可选中，右侧面板调整属性</li>
            <li>拖动元素可改变位置；按住空格拖动可平移画布</li>
            <li>滚轮平移视图，<code>Ctrl</code> + 滚轮缩放</li>
            <li>左侧「页面」页签管理多页，「图层」页签查看元素树</li>
            <li>选中按钮或列表项后，在右侧属性面板底部添加「点击跳转」</li>
            <li>修改设计 Token（如主色）会同步影响所有引用它的元素</li>
          </ul>
        </div>

        <div className="guide-card" style={{ marginBottom: 12 }}>
          <h4>第四步：预览与导出</h4>
          <p>
            点击顶栏的「预览」或按 <code>Ctrl+P</code> 进入原型预览，此时页面跳转真实可点，可验证完整流程。
          </p>
          <p style={{ marginTop: 6 }}>
            按 <code>Ctrl+E</code> 导出。支持 HTML 单文件、HTML 工程、PNG、SVG、Design JSON 五种格式。
          </p>
        </div>

        <div className="guide-card" style={{ marginBottom: 12 }}>
          <h4>外观主题</h4>
          <p>
            点击顶栏右侧的调色盘图标，可在「夜阑（深色）」「晨光（浅色）」「沧海（蓝调深色）」「墨韵（浅色紫调）」
            四套主题间即时切换，无需重启。选择会被记住，下次打开自动恢复。
          </p>
        </div>

        <div className="guide-card">
          <h4>快捷键速查</h4>
          <table style={{ width: '100%', fontSize: 12, color: 'var(--text-2)', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Ctrl+N / Ctrl+O', '新建 / 打开项目'],
                ['Ctrl+S / Ctrl+Shift+S', '保存 / 另存为'],
                ['Ctrl+Z / Ctrl+Shift+Z', '撤销 / 重做'],
                ['Ctrl+K', '增强提示词'],
                ['Ctrl+Enter', '开始生成'],
                ['Ctrl+E', '导出'],
                ['Ctrl+P', '预览原型'],
                ['Ctrl+,', '模型配置'],
                ['空格 + 拖动', '平移画布'],
                ['Ctrl + 滚轮', '缩放画布'],
                ['Ctrl+1 / Ctrl+0', '适应窗口 / 100%'],
                ['Delete', '删除选中元素'],
                ['Esc', '取消选中 / 关闭弹窗'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '3px 10px 3px 0', whiteSpace: 'nowrap' }}>
                    <code>{k}</code>
                  </td>
                  <td style={{ padding: '3px 0' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={() => openOverlay('settings')}>
            打开模型配置
          </Button>
        </div>
      </div>
    </Modal>
  )
}
