import ShareFab from './ShareFab'

/** @deprecated Use ShareFab — mantido pro import legado em BrandHeader/SiteHeader. */
export default function WhatsAppFab(props: { inline?: boolean }) {
  return <ShareFab inline={props.inline} />
}
