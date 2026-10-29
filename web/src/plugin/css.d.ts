/** The plugin imports its stylesheet as a string (esbuild `text` loader). */
declare module '*dpr-live.css' {
  const css: string
  export default css
}
