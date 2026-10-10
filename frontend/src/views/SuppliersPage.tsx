import { useParams } from 'react-router-dom'
import { ContactsPage } from './ContactsPage'

export function SuppliersPage() {
  const { supplierId } = useParams()
  return <ContactsPage kind="supplier" id={Number(supplierId) || 0} />
}
