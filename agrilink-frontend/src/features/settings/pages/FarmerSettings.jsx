import AccountSettings from '../components/AccountSettings'

export default function FarmerSettings({ onDeleted, onProfileUpdated }) {
  return <AccountSettings role="Farmer" onDeleted={onDeleted} onProfileUpdated={onProfileUpdated} />
}
