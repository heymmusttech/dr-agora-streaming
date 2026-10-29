import { redirect } from 'next/navigation'

/** Old address of the host studio, now `/host`. */
export default function EditorLiveStreamRedirect() {
  redirect('/host')
}
