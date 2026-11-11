import AccountSettings from '../components/AccountSettings'

export default function BuyerSettings({ onDeleted, onProfileUpdated }) {
  return <AccountSettings role="Buyer" onDeleted={onDeleted} onProfileUpdated={onProfileUpdated} />
}
