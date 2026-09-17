/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // 关闭 Tailwind 的 preflight（全局重置），避免与 MUI 的 CssBaseline 冲突。
  // 重置样式统一交给 MUI CssBaseline 负责，Tailwind 只提供原子类。
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effdfb',
          100: '#d6f7f2',
          200: '#b0ede6',
          300: '#7dddd4',
          400: '#43c4bb',
          500: '#16a89f',
          600: '#0d8a84',
          700: '#0f6e6a',
          800: '#115856',
          900: '#124947',
        },
      },
      boxShadow: {
        card: '0 8px 24px rgba(15, 23, 42, 0.055)',
        'card-hover': '0 18px 38px rgba(15, 23, 42, 0.12)',
        soft: '0 12px 32px rgba(15, 23, 42, 0.08)',
      },
      maxWidth: {
        app: '1180px',
      },
    },
  },
  plugins: [],
};
