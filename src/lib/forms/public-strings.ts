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
  chatHello: string
  chatOnline: string
  chatOffline: string
  chatOfflineNotice: string
  chatStart: string
  chatPlaceholder: string
  chatSend: string
  chatAttach: string
  chatTyping: string
  chatFailed: string
  chatReconnecting: string
  chatImageTooBig: string
  chatImageType: string
  chatUploadLimit: string
  chatAi: string
  optional: string
  chatUnavailable: string
  invalid_name: string
  invalid_message: string
  chatPhone: string
  chatDetailsPrompt: string
  chatSkip: string
  chatConnecting: string
  chatAgentJoined: string
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
    chatHello: 'Hello, how can I help you?',
    chatOnline: 'Online',
    chatOffline: 'Offline',
    chatOfflineNotice: 'We\'re offline right now. Leave a message and we\'ll reply as soon as we can.',
    chatStart: 'Start chat',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    chatAttach: 'Attach an image',
    chatTyping: 'Typing...',
    chatFailed: 'Not sent. Tap to retry.',
    chatReconnecting: 'Reconnecting...',
    chatImageTooBig: 'That image is too large (5 MB max).',
    chatImageType: 'Use a PNG, JPG, WebP or GIF image.',
    chatUploadLimit: 'This chat has reached its image limit.',
    chatAi: 'AI assistant',
    optional: 'optional',
    chatUnavailable: 'Chat is not available right now. Please try again later.',
    invalid_name: "Enter your real name",
    invalid_message: "Please write a short message",
    chatPhone: "Phone number",
    chatDetailsPrompt: "Before we connect you, could you share a few details?",
    chatSkip: "Skip",
    chatConnecting: "Connecting you to our team...",
    chatAgentJoined: "{name} just joined the chat",
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
    chatHello: 'Hola, ¿en qué puedo ayudarte?',
    chatOnline: 'En línea',
    chatOffline: 'Fuera de línea',
    chatOfflineNotice: 'Ahora estamos fuera de línea. Déjanos un mensaje y te responderemos en cuanto podamos.',
    chatStart: 'Iniciar chat',
    chatPlaceholder: 'Escribe un mensaje...',
    chatSend: 'Enviar',
    chatAttach: 'Adjuntar una imagen',
    chatTyping: 'Escribiendo...',
    chatFailed: 'No enviado. Toca para reintentar.',
    chatReconnecting: 'Reconectando...',
    chatImageTooBig: 'La imagen es demasiado grande (máx. 5 MB).',
    chatImageType: 'Usa una imagen PNG, JPG, WebP o GIF.',
    chatUploadLimit: 'Este chat alcanzó su límite de imágenes.',
    chatAi: 'Asistente de IA',
    optional: 'opcional',
    chatUnavailable: 'El chat no está disponible ahora. Inténtalo más tarde.',
    invalid_name: "Ingresa tu nombre real",
    invalid_message: "Escribe un mensaje breve",
    chatPhone: "Número de teléfono",
    chatDetailsPrompt: "Antes de conectarte, ¿puedes compartir algunos datos?",
    chatSkip: "Omitir",
    chatConnecting: "Conectándote con nuestro equipo...",
    chatAgentJoined: "{name} se unió al chat",
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
    chatHello: 'Bonjour, comment puis-je vous aider ?',
    chatOnline: 'En ligne',
    chatOffline: 'Hors ligne',
    chatOfflineNotice: 'Nous sommes hors ligne. Laissez un message, nous répondrons dès que possible.',
    chatStart: 'Démarrer le chat',
    chatPlaceholder: 'Écrivez un message...',
    chatSend: 'Envoyer',
    chatAttach: 'Joindre une image',
    chatTyping: 'Écrit...',
    chatFailed: 'Non envoyé. Touchez pour réessayer.',
    chatReconnecting: 'Reconnexion...',
    chatImageTooBig: 'Cette image est trop volumineuse (5 Mo max).',
    chatImageType: 'Utilisez une image PNG, JPG, WebP ou GIF.',
    chatUploadLimit: 'Ce chat a atteint sa limite d\'images.',
    chatAi: 'Assistant IA',
    optional: 'facultatif',
    chatUnavailable: 'Le chat n\'est pas disponible pour le moment. Réessayez plus tard.',
    invalid_name: "Saisissez votre vrai nom",
    invalid_message: "Écrivez un court message",
    chatPhone: "Numéro de téléphone",
    chatDetailsPrompt: "Avant de vous mettre en relation, pouvez-vous partager quelques informations ?",
    chatSkip: "Ignorer",
    chatConnecting: "Mise en relation avec notre équipe...",
    chatAgentJoined: "{name} vient de rejoindre le chat",
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
    chatHello: 'Olá, como posso ajudar?',
    chatOnline: 'Online',
    chatOffline: 'Offline',
    chatOfflineNotice: 'Estamos offline no momento. Deixe uma mensagem e responderemos assim que possível.',
    chatStart: 'Iniciar chat',
    chatPlaceholder: 'Digite uma mensagem...',
    chatSend: 'Enviar',
    chatAttach: 'Anexar uma imagem',
    chatTyping: 'Digitando...',
    chatFailed: 'Não enviado. Toque para tentar de novo.',
    chatReconnecting: 'Reconectando...',
    chatImageTooBig: 'A imagem é grande demais (máx. 5 MB).',
    chatImageType: 'Use uma imagem PNG, JPG, WebP ou GIF.',
    chatUploadLimit: 'Este chat atingiu o limite de imagens.',
    chatAi: 'Assistente de IA',
    optional: 'opcional',
    chatUnavailable: 'O chat não está disponível agora. Tente novamente mais tarde.',
    invalid_name: "Digite seu nome real",
    invalid_message: "Escreva uma mensagem curta",
    chatPhone: "Número de telefone",
    chatDetailsPrompt: "Antes de conectar você, pode compartilhar alguns dados?",
    chatSkip: "Pular",
    chatConnecting: "Conectando você à nossa equipe...",
    chatAgentJoined: "{name} entrou no chat",
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
    chatHello: '안녕하세요, 무엇을 도와드릴까요?',
    chatOnline: '온라인',
    chatOffline: '오프라인',
    chatOfflineNotice: '지금은 오프라인입니다. 메시지를 남겨주시면 가능한 한 빨리 답변드리겠습니다.',
    chatStart: '채팅 시작',
    chatPlaceholder: '메시지를 입력하세요...',
    chatSend: '보내기',
    chatAttach: '이미지 첨부',
    chatTyping: '입력 중...',
    chatFailed: '전송되지 않았습니다. 눌러서 다시 시도하세요.',
    chatReconnecting: '다시 연결하는 중...',
    chatImageTooBig: '이미지가 너무 큽니다(최대 5MB).',
    chatImageType: 'PNG, JPG, WebP 또는 GIF 이미지를 사용하세요.',
    chatUploadLimit: '이 채팅의 이미지 한도에 도달했습니다.',
    chatAi: 'AI 어시스턴트',
    optional: '선택',
    chatUnavailable: '지금은 채팅을 이용할 수 없습니다. 나중에 다시 시도해 주세요.',
    invalid_name: "실제 이름을 입력해 주세요",
    invalid_message: "짧은 메시지를 입력해 주세요",
    chatPhone: "전화번호",
    chatDetailsPrompt: "연결하기 전에 몇 가지 정보를 알려 주시겠어요?",
    chatSkip: "건너뛰기",
    chatConnecting: "팀에 연결하는 중...",
    chatAgentJoined: "{name}님이 채팅에 참여했습니다",
  },
}

export function stringsFor(lang: string | undefined | null): PublicStrings {
  return PUBLIC_STRINGS[(lang as PublicLang) in PUBLIC_STRINGS ? (lang as PublicLang) : 'en']
}
