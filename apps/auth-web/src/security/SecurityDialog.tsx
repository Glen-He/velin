import { Modal } from '@velin/ui/Modal.tsx'
import { PasswordField } from '@velin/ui/PasswordField.tsx'
import { passwordPolicyMessage } from '@velin/contracts/policy'
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Mail,
  ScrollText,
  Timer,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { TotpQRCode } from './TotpQRCode'
import type { useSendSlot } from '../shared'
import {
  stepUpChannelLabel,
  stepUpFieldLabel,
  stepUpOperationLabel,
} from './security-api'
import type { StepUpChannel } from './security-api'
import { useSecurityFlow } from './useSecurityFlow'
import type { SecurityDialogProps } from './useSecurityFlow'

// 每个通道配一个语义图标，列表行靠它做视觉引导。
const channelIcons: Record<StepUpChannel, LucideIcon> = {
  emailOtp: Mail,
  passkey: KeyRound,
  totp: Timer,
  backupCode: ScrollText,
}

export function SecurityDialog({
  operation,
  requirement,
  email,
  hasPasskey,
  hasTwoFactor,
  passkeyId,
  onClose,
  onCompleted,
}: SecurityDialogProps) {
  const flow = useSecurityFlow({
    operation,
    requirement,
    email,
    hasPasskey,
    hasTwoFactor,
    passkeyId,
    onClose,
    onCompleted,
  })
  const {
    stage,
    previousStage,
    channel,
    code,
    setCode,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    newEmail,
    setNewEmail,
    newEmailCode,
    setNewEmailCode,
    enrollment,
    message,
    setMessage,
    verifying,
    working,
    stepUpSend,
    newEmailSend,
    codeRef,
    passwordRef,
    alternatives,
    listedChannels,
    listRows,
    canGoBack,
    restartVerification,
    filled,
    advanceReady,
    requestEmailCode,
    requestNewEmailCode,
    pushStage,
    goBack,
    backToPasswordStage,
    choose,
    confirmStepUp,
    savePassword,
    submitNewPassword,
    changeToNewEmail,
    submitTwoFactorPassword,
    finishTwoFactor,
    notice,
  } = flow
  const passwordInput = (
    label: string,
    value: string,
    setValue: (next: string) => void,
    autoComplete: string,
    inputRef?: React.RefObject<HTMLInputElement | null>,
  ) => (
    <PasswordField
      label={label}
      value={value}
      autoComplete={autoComplete}
      required
      inputRef={inputRef}
      onChange={(event) => {
        setValue(event.target.value)
        setMessage(null)
      }}
    />
  )

  // 输入框的说明文字必须跟着步骤走，不能沿用上一个步骤的通道名。
  // 提示行放在操作行上方，卡片的最后一件元素始终是按钮，
  // 这样底部边距和顶部边距都是卡片 padding，两边相等。
  const noticeLine = (
    <p
      className={message ? 'dialog-notice error-message' : 'dialog-notice'}
      role={message ? 'alert' : undefined}
    >
      {notice}
    </p>
  )

  // 发码状态必须显式带上收件地址：升级验证码和新邮箱验证码是两个不同的接收方。
  const codeInput = (
    label: string,
    value: string,
    setValue: (next: string) => void,
    send?: {
      state: ReturnType<typeof useSendSlot>
      request: () => void
      // 收件地址还没填时发送一并禁用，和推进按钮同一套规则。
      blocked?: boolean
    },
  ) => (
    <span className={send ? 'code-field has-send' : 'code-field'}>
      <input
        ref={codeRef}
        className="web-field"
        autoComplete={channel === 'backupCode' ? 'off' : 'one-time-code'}
        inputMode={channel === 'backupCode' ? 'text' : 'numeric'}
        maxLength={channel === 'backupCode' ? 128 : 6}
        required
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(event) => {
          setValue(
            channel === 'backupCode'
              ? event.target.value.trim()
              : event.target.value.replace(/\D/g, ''),
          )
          setMessage(null)
        }}
      />
      {send ? (
        <button
          className="field-send"
          type="button"
          disabled={send.state.busy || Boolean(send.blocked)}
          onClick={send.request}
        >
          {send.state.remaining > 0
            ? '已发送'
            : send.state.sent
              ? '重发'
              : '发送'}
        </button>
      ) : null}
    </span>
  )

  // 文字入口属于正文最后一槽，操作行只放取消与推进，两者不抢同一行。
  const switchEntry = (label: string, onClick: () => void) => (
    <button
      className="text-button dialog-switch"
      type="button"
      disabled={working || verifying}
      onClick={onClick}
    >
      {label}
    </button>
  )

  const cancelButton = (
    <button
      className="security-action is-outline"
      type="button"
      onClick={onClose}
    >
      取消
    </button>
  )

  return (
    <Modal
      label={stepUpOperationLabel(operation)}
      onClose={onClose}
      focusKey={stage}
    >
      <div className="web-modal-scrim" onPointerDown={onClose}>
        <div
          className={`web-modal security-dialog is-${operation}${
            listRows > 0 ? ` is-alt-${listRows}` : ''
          }`}
          aria-label={`${stepUpOperationLabel(operation)}`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* 顶部操作带：返回钉在左端、叉叉钉在右端，第一屏没有返回时叉叉也不挪位。 */}
          <div className="dialog-bar">
            {canGoBack ? (
              <button
                className="dialog-back"
                type="button"
                aria-label="返回上一步"
                onClick={goBack}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="dialog-close"
              type="button"
              aria-label="关闭"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
          </div>

          <h2 className="web-modal-title">
            {stage === 'methods'
              ? '换一种验证方式'
              : stage === 'newPassword'
                ? '设置新密码'
                : stepUpOperationLabel(operation)}
          </h2>

          {/* 每一步都占满「字段区 + 提示行 + 操作行」三个槽，内容组在字段区里上下居中，
            操作行贴底；卡片高度按该操作最高的一步固定，不随步骤变化。 */}
          <div className="dialog-body">
            {stage === 'verify' ? (
              <form
                className="dialog-stage"
                noValidate
                onSubmit={confirmStepUp}
              >
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    {channel === 'passkey' ? (
                      <p className="panel-hint">
                        使用设备解锁或安全密钥完成验证。
                      </p>
                    ) : (
                      <>
                        {/* 这条流程会往两个不同地址发码，不说清发到谁用户只能猜。 */}
                        {channel === 'emailOtp' ? (
                          <p className="panel-hint">验证码将发送至 {email}。</p>
                        ) : null}
                        <div className="field-row">
                          {codeInput(
                            stepUpFieldLabel(channel),
                            code,
                            setCode,
                            channel === 'emailOtp'
                              ? {
                                  state: stepUpSend,
                                  request: () => void requestEmailCode(),
                                }
                              : undefined,
                          )}
                        </div>
                      </>
                    )}
                    {alternatives.length > 0
                      ? switchEntry('换一种验证方式', () =>
                          pushStage('methods'),
                        )
                      : null}
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  {/* 删除通行密钥没有第二层确认：验证一过就直接删除，
                    所以这一步的提交是危险操作的最终确认，不是普通主操作。 */}
                  <button
                    className={
                      operation === 'removePasskey'
                        ? 'security-action is-danger-primary'
                        : 'security-action is-primary'
                    }
                    type="submit"
                    disabled={verifying || !advanceReady}
                  >
                    {channel === 'passkey' ? '验证' : '确认'}
                  </button>
                </div>
              </form>
            ) : null}

            {stage === 'methods' ? (
              <div className="dialog-stage">
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <div
                      className="dialog-options"
                      role="group"
                      aria-label="验证方式"
                    >
                      {listedChannels.map((method) => {
                        const Icon = channelIcons[method]

                        return (
                          <button
                            className="dialog-option"
                            key={method}
                            type="button"
                            onClick={() => choose(method)}
                          >
                            <Icon
                              className="dialog-option-icon"
                              aria-hidden="true"
                            />
                            {stepUpChannelLabel(method)}
                            <ChevronRight
                              className="dialog-option-chevron"
                              aria-hidden="true"
                            />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {noticeLine}
                {/* 这一步没有按钮，唯一的文字入口占住操作行槽位：靠左、贴底，
                  与卡片底边只隔一个内边距，和其他步骤的按钮同一条基线。 */}
                <div className="dialog-foot">
                  {previousStage === 'password'
                    ? switchEntry('返回用旧密码修改', backToPasswordStage)
                    : switchEntry(`返回${stepUpChannelLabel(channel)}`, goBack)}
                </div>
              </div>
            ) : null}

            {stage === 'password' ? (
              <form className="dialog-stage" noValidate onSubmit={savePassword}>
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <div className="field-row">
                      {passwordInput(
                        '当前密码',
                        currentPassword,
                        setCurrentPassword,
                        'current-password',
                        passwordRef,
                      )}
                    </div>
                    <div className="field-row">
                      {passwordInput(
                        '新密码',
                        newPassword,
                        setNewPassword,
                        'new-password',
                      )}
                    </div>
                    <div className="field-row">
                      {passwordInput(
                        '确认新密码',
                        confirmPassword,
                        setConfirmPassword,
                        'new-password',
                      )}
                    </div>
                    {/* 密码规则只在真正要设新密码的界面说，不常驻总览页。 */}
                    <p className="panel-hint">{passwordPolicyMessage}</p>
                    {switchEntry('用其他方式修改？', () =>
                      pushStage('methods'),
                    )}
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  <button
                    className="security-action is-primary"
                    type="submit"
                    disabled={working || !advanceReady}
                  >
                    保存
                  </button>
                </div>
              </form>
            ) : null}

            {stage === 'newPassword' ? (
              <form
                className="dialog-stage"
                noValidate
                onSubmit={submitNewPassword}
              >
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <div className="field-row">
                      {passwordInput(
                        '新密码',
                        newPassword,
                        setNewPassword,
                        'new-password',
                      )}
                    </div>
                    <div className="field-row">
                      {passwordInput(
                        '确认新密码',
                        confirmPassword,
                        setConfirmPassword,
                        'new-password',
                      )}
                    </div>
                    <p className="panel-hint">{passwordPolicyMessage}</p>
                    {switchEntry('返回用旧密码修改', backToPasswordStage)}
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  <button
                    className="security-action is-primary"
                    type="submit"
                    disabled={working || !advanceReady}
                  >
                    确认
                  </button>
                </div>
              </form>
            ) : null}

            {stage === 'newEmail' ? (
              <form
                className="dialog-stage"
                noValidate
                onSubmit={changeToNewEmail}
              >
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <div className="field-row">
                      <input
                        ref={passwordRef}
                        className="web-field"
                        type="email"
                        autoComplete="email"
                        required
                        value={newEmail}
                        placeholder="新邮箱"
                        aria-label="新邮箱"
                        onChange={(event) => {
                          setNewEmail(event.target.value)
                          setMessage(null)
                          // 收件地址一改，之前那次发送就不属于这个地址了，
                          // 按钮必须回到「发送」，不能顶着「重发」说已经往这里发过。
                          setNewEmailCode('')
                        }}
                      />
                    </div>
                    <div className="field-row">
                      {codeInput(
                        '新邮箱验证码',
                        newEmailCode,
                        setNewEmailCode,
                        {
                          state: newEmailSend,
                          request: () => void requestNewEmailCode(),
                          blocked: !filled(newEmail),
                        },
                      )}
                    </div>
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  <button
                    className="security-action is-primary"
                    type="submit"
                    disabled={working || !advanceReady}
                  >
                    确认
                  </button>
                </div>
              </form>
            ) : null}

            {stage === 'twoFactorPassword' ? (
              <form
                className="dialog-stage"
                noValidate
                onSubmit={submitTwoFactorPassword}
              >
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <div className="field-row">
                      {passwordInput(
                        '当前密码',
                        currentPassword,
                        setCurrentPassword,
                        'current-password',
                        passwordRef,
                      )}
                    </div>
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  <button
                    className={
                      operation === 'disableTwoFactor'
                        ? 'security-action danger-button'
                        : 'security-action is-primary'
                    }
                    type="submit"
                    disabled={working || !advanceReady}
                  >
                    {operation === 'disableTwoFactor' ? '关闭' : '下一步'}
                  </button>
                </div>
              </form>
            ) : null}

            {stage === 'totpVerify' && enrollment ? (
              <form
                className="dialog-stage"
                noValidate
                onSubmit={finishTwoFactor}
              >
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <p className="panel-hint">
                      用验证器应用扫描此码，再输入它生成的 6 位动态码。
                    </p>
                    <div className="qr-code">
                      <TotpQRCode size={144} value={enrollment.totpURI} />
                    </div>
                    <div className="field-row">
                      {codeInput('动态验证码', code, setCode)}
                    </div>
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  <button
                    className="security-action is-primary"
                    type="submit"
                    disabled={working || !advanceReady}
                  >
                    启用
                  </button>
                </div>
              </form>
            ) : null}

            {stage === 'backupCodes' && enrollment ? (
              <div className="dialog-stage">
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <p className="panel-hint">
                      每个恢复码只能使用一次，请立即保存到密码管理器。
                    </p>
                    <code className="backup-code-list">
                      {enrollment.backupCodes.map((value, index) => (
                        <span key={`${value}-${index}`}>{value}</span>
                      ))}
                    </code>
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  <button
                    className="security-action is-primary"
                    type="button"
                    onClick={() => onCompleted('双重认证已开启。')}
                  >
                    完成
                  </button>
                </div>
              </div>
            ) : null}

            {stage === 'running' ? (
              <div className="dialog-stage">
                <div className="dialog-fields">
                  <div className="dialog-fields-inner">
                    <p className="panel-hint">
                      {operation === 'addPasskey'
                        ? '请在系统弹窗中完成通行密钥创建。'
                        : '正在处理，请稍候。'}
                    </p>
                  </div>
                </div>
                {noticeLine}
                <div className="dialog-foot">
                  {cancelButton}
                  {!working && message ? (
                    <button
                      type="button"
                      className="security-action is-primary"
                      onClick={restartVerification}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}
