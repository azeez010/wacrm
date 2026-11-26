// Example WhatsApp message templates people can copy. Variables use WhatsApp's {{1}} style.
// They are starting points: each business must submit its own wording to Meta for approval.

export interface TemplateExample {
  id: string
  industry: string
  title: string
  category: 'Utility' | 'Marketing'
  /** What the numbered variables stand for. */
  variables: string[]
  body: string
}

export const TEMPLATE_EXAMPLES: TemplateExample[] = [
  { id: 'order-confirmation', industry: 'Retail and fashion', title: 'Order confirmation', category: 'Utility', variables: ['Customer name', 'Order number'], body: 'Hello {{1}}, thank you for your order {{2}}. We are preparing it now and will message you when it is ready for delivery.' },
  { id: 'delivery-update', industry: 'Retail and fashion', title: 'Delivery update', category: 'Utility', variables: ['Customer name', 'Order number', 'Delivery time'], body: 'Hi {{1}}, your order {{2}} is on its way. Expected delivery: {{3}}. Reply here if you need to change the address.' },
  { id: 'new-arrivals', industry: 'Retail and fashion', title: 'New arrivals', category: 'Marketing', variables: ['Customer name'], body: 'Hi {{1}}, our new arrivals are in. Reply YES and we will send you the catalogue.' },
  { id: 'table-reservation', industry: 'Restaurants', title: 'Table reservation', category: 'Utility', variables: ['Customer name', 'Date and time', 'Number of guests'], body: 'Hello {{1}}, your table for {{3}} is booked for {{2}}. Reply CANCEL if your plans change.' },
  { id: 'weekend-offer', industry: 'Restaurants', title: 'Weekend offer', category: 'Marketing', variables: ['Customer name', 'Offer'], body: 'Hi {{1}}, this weekend only: {{2}}. Reply ORDER to place yours.' },
  { id: 'appointment-reminder', industry: 'Clinics and salons', title: 'Appointment reminder', category: 'Utility', variables: ['Customer name', 'Date and time'], body: 'Hello {{1}}, this is a reminder of your appointment on {{2}}. Reply 1 to confirm or 2 to reschedule.' },
  { id: 'follow-up-visit', industry: 'Clinics and salons', title: 'After-visit follow-up', category: 'Utility', variables: ['Customer name'], body: 'Hi {{1}}, thank you for visiting us. How are you feeling? Reply here if you have any questions.' },
  { id: 'fee-reminder', industry: 'Schools', title: 'Fee reminder', category: 'Utility', variables: ['Parent name', 'Student name', 'Amount', 'Due date'], body: 'Dear {{1}}, this is a reminder that {{2}}’s fees of {{3}} are due on {{4}}. Reply here for payment details.' },
  { id: 'school-notice', industry: 'Schools', title: 'School notice', category: 'Utility', variables: ['Parent name', 'Notice'], body: 'Dear {{1}}, a quick notice from the school: {{2}}. Reply here if you have questions.' },
  { id: 'viewing-booking', industry: 'Real estate', title: 'Viewing booking', category: 'Utility', variables: ['Customer name', 'Property', 'Date and time'], body: 'Hello {{1}}, your viewing of {{2}} is booked for {{3}}. We will send the location before then.' },
  { id: 'parcel-pickup', industry: 'Logistics', title: 'Parcel ready for pickup', category: 'Utility', variables: ['Customer name', 'Tracking number'], body: 'Hi {{1}}, your parcel {{2}} has arrived and is ready for pickup. Reply here to arrange delivery instead.' },
  { id: 'login-code', industry: 'Any business with an app', title: 'Login or verification code', category: 'Utility', variables: ['Code'], body: '{{1}} is your verification code. It expires in 10 minutes. Do not share it with anyone.' },
]
