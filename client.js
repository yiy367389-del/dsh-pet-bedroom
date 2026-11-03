/**
 * dsh-pet-bedroom · 浏览器半侧（v3.1）
 * ============================================================================
 * **这个插件不在 DSH 应用里渲染任何东西。**
 *
 * v2 曾把全屏浮层挂在 `shell.overlay` 上：关闭时只设 `opacity:0`，但遮罩
 * 仍带着 `pointer-events:auto` 铺满视口，整页表现为「静默卡死」。已彻底移除。
 *
 * 现在只做一件事：在侧边栏底部放一个普通按钮，点它**同窗口跳转**到
 * `/dsh-pet-bedroom/` 那个独立网页。
 *
 * 为什么用 `location.assign` 而不是 `window.open`：
 * DSH 桌面应用（Electron）里 `window.open` 常被拦成空白窗口，
 * 用户看到的就是「黑屏」——这个坑真实踩过。同窗口跳转最稳，
 * 想回应用按浏览器后退（或 Alt+←）即可。
 */

window.__ModuleLoader__.load({
  id: 'dsh-pet-bedroom',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ROOM_URL = '/dsh-pet-bedroom/';

    /** 侧边栏底部的入口按钮：只占按钮自己的盒子，无定位、无 z-index、无覆盖层 */
    function BedroomLauncher() {
      const open = React.useCallback(() => {
        window.location.assign(new URL(ROOM_URL, window.location.origin).toString());
      }, []);

      return h(
        'button',
        {
          type: 'button',
          onClick: open,
          title: '打开桌宠卧室（同窗口打开，用浏览器后退可返回）',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary, #9fb0c8)',
            font: '600 12px/1 "Microsoft YaHei", system-ui, sans-serif',
            cursor: 'pointer',
          },
        },
        h(
          'svg',
          { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M3 10.5 12 3l9 7.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
          h('path', { d: 'M5.5 9.8V20h13V9.8', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' }),
        ),
        '卧室',
      );
    }

    function apply(ctx) {
      // 只注册一个侧边栏动作行——**不碰 shell.overlay**。
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ name: 'sidebar.footer.action', id: 'pet-bedroom-open', order: 60 }, BedroomLauncher),
      );
    }

    return { name: 'pet-bedroom', inject: ['slots'], apply };
  },
});
