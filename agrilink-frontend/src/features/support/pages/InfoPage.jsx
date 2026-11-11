/* Content pages linked from the footer (company, farmer & buyer guides, legal). */
export const INFO_PAGES = {
  'seasonal-calendar': { title: 'Seasonal calendar', intro: 'When Kenyan produce is at its best.', sections: [
    ['Long rains (March  to  May)', 'Planting season for maize, beans and potatoes. Leafy greens like sukuma wiki and spinach are plentiful.'],
    ['Cool dry season (June  to  September)', 'Main harvest for maize and beans. Potatoes, cabbages and carrots are abundant and well priced.'],
    ['Short rains (October  to  December)', 'Second planting season. Tomatoes, onions and fruits such as mangoes and avocados come into supply.'],
    ['Hot dry season (January  to  February)', 'Irrigated vegetables, watermelons and stored grains. Prices for fresh greens tend to rise.']] },
  'seller-guidelines': { title: 'Seller guidelines', intro: 'How to list and sell produce on AgriLink.', sections: [
    ['Honest listings', 'Use real photos of your produce, accurate quantities and the correct quality grade.'],
    ['Fair pricing', 'Set clear prices per unit. Check market intelligence to stay competitive.'],
    ['Respond quickly', 'Reply to buyer inquiries and confirm orders within 24 hours.'],
    ['Deliver as promised', 'Pack produce well and keep buyers updated on delivery.']] },
  pricing: { title: 'Pricing & fees', intro: 'Simple, transparent fees.', sections: [
    ['Free to join', 'Creating a farmer or buyer account and listing produce is free.'],
    ['Small service fee', 'A small platform fee is deducted only when an order is paid.'],
    ['No hidden costs', 'You see the full breakdown in your dashboard before every payout.']] },
  payouts: { title: 'Payouts', intro: 'Getting paid for your produce.', sections: [
    ['M-Pesa payouts', 'Earnings from paid orders can be withdrawn to your M-Pesa number.'],
    ['Bank transfer', 'Larger payouts can be sent to your bank account.'],
    ['Timing', 'Withdrawal requests are reviewed and processed within 1 to 3 working days.']] },
  resources: { title: 'Farming resources', intro: 'Tools to grow better and sell smarter.', sections: [
    ['AI farming assistant', 'Ask questions about crops, pests and soil from your farmer dashboard.'],
    ['Market intelligence', 'See current prices across counties before you sell.'],
    ['Harvest planner', 'Plan what to plant based on demand and season.']] },
  'bulk-orders': { title: 'Bulk orders', intro: 'Buying for a hotel, school, shop or processor?', sections: [
    ['Sourcing requests', 'Post what you need from your buyer dashboard and farmers will respond with offers.'],
    ['Supplier matching', 'Our AI tools match you with farmers who can supply the volume you need.'],
    ['Talk to us', 'Contact our team for large recurring contracts.']] },
  delivery: { title: 'Delivery info', intro: 'How your produce reaches you.', sections: [
    ['Farmer delivery', 'Many farmers deliver directly within their county.'],
    ['Pickup', 'You can arrange to collect from the farm or a nearby collection point.'],
    ['Tracking', 'Follow every order stage, confirmed, packed, on the way, delivered, in your orders page.']] },
  mission: { title: 'Our mission', intro: 'Fair markets for every Kenyan farmer.', sections: [
    ['Zero middlemen', 'We connect farmers directly with buyers so farmers earn more and buyers pay less.'],
    ['Less waste', 'Better market information means less produce is lost after harvest.'],
    ['Smarter farming', 'We bring AI tools and price data to small scale farmers.']] },
  careers: { title: 'Careers', intro: 'Help us transform agriculture in Kenya.', sections: [
    ['Open roles', 'We do not have open roles right now. Send us your CV through the contact page and we will reach out when something fits.']] },
  press: { title: 'Press & media', intro: 'News and media enquiries.', sections: [
    ['Media enquiries', 'For interviews, logos and press material, please reach us through the contact page.']] },
  blog: { title: 'Blog', intro: 'Stories from farmers and buyers.', sections: [
    ['Coming soon', 'Our blog with farming tips, market updates and success stories is on the way.']] },
  'trust-safety': { title: 'Trust & safety', intro: 'Keeping the marketplace safe.', sections: [
    ['Verified farms', 'Farms are reviewed by our team before receiving a verified badge.'],
    ['Secure payments', 'Pay through M-Pesa or card on the platform, never send money outside AgriLink.'],
    ['Report problems', 'Report suspicious listings or users through the contact page and we will investigate.']] },
  community: { title: 'Community forum', intro: 'Learn from other farmers and buyers.', sections: [
    ['Coming soon', 'A space for farmers and buyers to share advice is on the way. Meanwhile, use the AI farming assistant in your dashboard.']] },
  privacy: { title: 'Privacy Policy', intro: 'How we handle your information.', sections: [
    ['What we collect', 'Your name, contact details, location, listings and order history needed to run the marketplace.'],
    ['How we use it', 'To process orders, payments and deliveries, and to improve our services. We never sell your data.'],
    ['Your rights', 'You can view, update or ask us to delete your information at any time through the contact page.']] },
  terms: { title: 'Terms of Service', intro: 'The rules for using AgriLink.', sections: [
    ['Accounts', 'Keep your login details safe and provide accurate information.'],
    ['Listings & orders', 'Sellers must describe produce honestly; buyers must pay for confirmed orders.'],
    ['Disputes', 'Contact us if something goes wrong and we will help both sides reach a fair outcome.']] },
  cookies: { title: 'Cookie Policy', intro: 'How we use cookies.', sections: [
    ['Essential', 'We store your sign in, theme and language choice so the site works properly.'],
    ['Translation', 'Choosing a language saves a small cookie used by Google Translate.']] },
  'acceptable-use': { title: 'Acceptable Use', intro: 'What is not allowed on AgriLink.', sections: [
    ['Prohibited', 'Fake listings, fraud, abusive messages, and selling illegal or unsafe products.'],
    ['Enforcement', 'Accounts that break these rules may be blocked.']] },
  accessibility: { title: 'Accessibility', intro: 'AgriLink for everyone.', sections: [
    ['Our commitment', 'We support keyboard navigation, screen readers, dark mode and multiple languages.'],
    ['Feedback', 'If something is hard to use, tell us through the contact page.']] },
}

export default function InfoPage({ id, onNavigate }) {
  const p = INFO_PAGES[id]
  if (!p) return null
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="font-display text-3xl font-bold text-ink md:text-4xl">{p.title}</h1>
      <p className="mt-2 text-muted">{p.intro}</p>
      <div className="mt-8 space-y-4">
        {p.sections.map(([h, t]) => (
          <section key={h} className="rounded-2xl border border-line bg-paper p-5">
            <h2 className="font-display text-lg font-semibold text-ink">{h}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{t}</p>
          </section>
        ))}
      </div>
      <button onClick={() => onNavigate('contact')} className="mt-8 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90">
        Contact us
      </button>
    </div>
  )
}
