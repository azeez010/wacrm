// Built-in wording on the public form, per form language. The owner's own
// labels/messages are free text; only these defaults and errors are translated.

export type PublicLang = 'en' | 'es' | 'fr' | 'pt' | 'ko'

export interface PublicStrings {
  submit: string
  sending: string
  required: string
  invalid_phone: string
  invalid_email: string
  invalid_choice: string
  generic_error: string
  too_many: string
  thanks: string
  closed: string
  unavailable: string
  continueWhatsapp: string
  scanQr: string
  followUp: string
  phone: string
  name: string
  email: string
  company: string
  message: string
  select: string
  powered: string
  poweredBy: string
  offline: string
}

export const PUBLIC_STRINGS: Record<PublicLang, PublicStrings> = {
  en: {
    submit: 'Submit',
    sending: 'Sending...',
    required: 'This field is required',
    invalid_phone: 'Enter a valid WhatsApp number',
    invalid_email: 'Enter a valid email address',
    invalid_choice: 'Choose one of the options',
    generic_error: 'Something went wrong. Please try again.',
    too_many: 'Too many attempts. Please wait a minute.',
    thanks: 'Thank you! We received your details.',
    closed: 'This form is closed.',
    unavailable: 'This form is not available right now.',
    continueWhatsapp: 'Continue in WhatsApp',
    scanQr: 'On a computer? Scan with your phone',
    followUp: "Or we'll message you on WhatsApp shortly.",
    phone: 'WhatsApp number',
    name: 'Name',
    email: 'Email',
    company: 'Company',
    message: 'Message',
    select: 'Select...',
    powered: 'Powered by OgaDesk',
    poweredBy: 'Powered by',
    offline: 'We are offline right now. Leave your number and we will reply.',
  },
  es: {
    submit: 'Enviar',
    sending: 'Enviando...',
    required: 'Este campo es obligatorio',
    invalid_phone: 'Ingresa un número de WhatsApp válido',
    invalid_email: 'Ingresa un correo válido',
    invalid_choice: 'Elige una de las opciones',
    generic_error: 'Algo salió mal. Inténtalo de nuevo.',
    too_many: 'Demasiados intentos. Espera un minuto.',
    thanks: '¡Gracias! Recibimos tus datos.',
    closed: 'Este formulario está cerrado.',
    unavailable: 'Este formulario no está disponible ahora.',
    continueWhatsapp: 'Continuar en WhatsApp',
    scanQr: '¿En una computadora? Escanea con tu teléfono',
    followUp: 'O te escribiremos por WhatsApp en breve.',
    phone: 'Número de WhatsApp',
    name: 'Nombre',
    email: 'Correo',
    company: 'Empresa',
    message: 'Mensaje',
    select: 'Selecciona...',
    powered: 'Con tecnología de OgaDesk',
    poweredBy: 'Con tecnología de',
    offline: 'Estamos fuera de línea. Deja tu número y te responderemos.',
  },
  fr: {
    submit: 'Envoyer',
    sending: 'Envoi...',
    required: 'Ce champ est obligatoire',
    invalid_phone: 'Saisissez un numéro WhatsApp valide',
    invalid_email: 'Saisissez une adresse e-mail valide',
    invalid_choice: 'Choisissez une des options',
    generic_error: "Une erreur s'est produite. Réessayez.",
    too_many: 'Trop de tentatives. Patientez une minute.',
    thanks: 'Merci ! Nous avons bien reçu vos informations.',
    closed: 'Ce formulaire est fermé.',
    unavailable: "Ce formulaire n'est pas disponible pour le moment.",
    continueWhatsapp: 'Continuer sur WhatsApp',
    scanQr: 'Sur ordinateur ? Scannez avec votre téléphone',
    followUp: 'Ou nous vous écrirons sur WhatsApp sous peu.',
    phone: 'Numéro WhatsApp',
    name: 'Nom',
    email: 'E-mail',
    company: 'Entreprise',
    message: 'Message',
    select: 'Sélectionner...',
    powered: 'Propulsé par OgaDesk',
    poweredBy: 'Propulsé par',
    offline: 'Nous sommes hors ligne. Laissez votre numéro, nous répondrons.',
  },
  pt: {
    submit: 'Enviar',
    sending: 'Enviando...',
    required: 'Este campo é obrigatório',
    invalid_phone: 'Informe um número de WhatsApp válido',
    invalid_email: 'Informe um e-mail válido',
    invalid_choice: 'Escolha uma das opções',
    generic_error: 'Algo deu errado. Tente novamente.',
    too_many: 'Muitas tentativas. Aguarde um minuto.',
    thanks: 'Obrigado! Recebemos seus dados.',
    closed: 'Este formulário está fechado.',
    unavailable: 'Este formulário não está disponível agora.',
    continueWhatsapp: 'Continuar no WhatsApp',
    scanQr: 'No computador? Escaneie com o celular',
    followUp: 'Ou entraremos em contato pelo WhatsApp em breve.',
    phone: 'Número do WhatsApp',
    name: 'Nome',
    email: 'E-mail',
    company: 'Empresa',
    message: 'Mensagem',
    select: 'Selecione...',
    powered: 'Feito com OgaDesk',
    poweredBy: 'Feito com',
    offline: 'Estamos offline. Deixe seu número e responderemos.',
  },
  ko: {
    submit: '제출',
    sending: '보내는 중...',
    required: '필수 항목입니다',
    invalid_phone: '올바른 WhatsApp 번호를 입력하세요',
    invalid_email: '올바른 이메일을 입력하세요',
    invalid_choice: '옵션 중에서 선택하세요',
    generic_error: '문제가 발생했습니다. 다시 시도하세요.',
    too_many: '시도 횟수가 너무 많습니다. 잠시 후 다시 시도하세요.',
    thanks: '감사합니다! 정보를 받았습니다.',
    closed: '이 양식은 마감되었습니다.',
    unavailable: '이 양식은 지금 사용할 수 없습니다.',
    continueWhatsapp: 'WhatsApp에서 계속하기',
    scanQr: '컴퓨터인가요? 휴대폰으로 스캔하세요',
    followUp: '또는 곧 WhatsApp으로 연락드리겠습니다.',
    phone: 'WhatsApp 번호',
    name: '이름',
    email: '이메일',
    company: '회사',
    message: '메시지',
    select: '선택...',
    powered: 'OgaDesk 제공',
    poweredBy: '제공',
    offline: '현재 오프라인입니다. 번호를 남겨주시면 답변드리겠습니다.',
  },
}

export function stringsFor(lang: string | undefined | null): PublicStrings {
  return PUBLIC_STRINGS[(lang as PublicLang) in PUBLIC_STRINGS ? (lang as PublicLang) : 'en']
}
