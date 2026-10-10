import { useParams } from 'react-router-dom'
import { ContactsPage } from './ContactsPage'

export function ClientsPage() {
  const { clientId } = useParams()
  return <ContactsPage kind="client" id={Number(clientId) || 0} />
}
