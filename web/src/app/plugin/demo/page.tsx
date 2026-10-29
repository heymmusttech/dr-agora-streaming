import { redirect } from 'next/navigation'

/** The plugin preview is now a sheet on the host console. */
export default function PluginPreviewRedirect() {
  redirect('/host?preview=1')
}
