import type { Locale } from '@/i18n/locales'

export type ChangeKind = 'New' | 'Improved' | 'Fixed'

/** English is required; a missing language falls back to it. */
export type Localized = { en: string } & Partial<Record<Locale, string>>

export interface ChangelogEntry {
  /** ISO date, newest first. */
  date: string
  changes: { kind: ChangeKind; text: Localized }[]
}

export const changeText = (text: Localized, locale: Locale): string => text[locale] ?? text.en

/** Add new releases at the top. Keep each line short and about what customers can do now. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-11-26',
    changes: [
      {
        kind: 'New',
        text: {
          en: 'Partner program: every customer gets a referral link, live stats and a leaderboard spot. See what you could earn at /partners.',
          fr: 'Programme partenaire : chaque client reçoit un lien de parrainage, des statistiques en direct et une place au classement. Voyez ce que vous pourriez gagner sur /partners.',
          es: 'Programa de socios: cada cliente recibe un enlace de referido, estadísticas en vivo y un lugar en el ranking. Mira lo que podrías ganar en /partners.',
          pt: 'Programa de parceiros: cada cliente recebe um link de indicação, estatísticas ao vivo e um lugar no ranking. Veja quanto você pode ganhar em /partners.',
          ko: '파트너 프로그램: 모든 고객이 추천 링크, 실시간 통계, 리더보드 자리를 받습니다. /partners에서 예상 수익을 확인해 보세요.',
        },
      },
      {
        kind: 'New',
        text: {
          en: 'Prices now show in your own currency, converted from naira.',
          fr: 'Les prix s’affichent désormais dans votre devise, convertis depuis le naira.',
          es: 'Los precios ahora se muestran en tu moneda, convertidos desde nairas.',
          pt: 'Os preços agora aparecem na sua moeda, convertidos a partir do naira.',
          ko: '이제 가격이 나이라에서 환산된 내 통화로 표시됩니다.',
        },
      },
      {
        kind: 'New',
        text: {
          en: 'A public blog and this changelog, in all five languages.',
          fr: 'Un blog public et ce journal des nouveautés, dans les cinq langues.',
          es: 'Un blog público y estas novedades, en los cinco idiomas.',
          pt: 'Um blog público e estas novidades, nos cinco idiomas.',
          ko: '공개 블로그와 이 업데이트 소식을 다섯 가지 언어로 제공합니다.',
        },
      },
      {
        kind: 'Improved',
        text: {
          en: 'Marketing emails are a simple on/off switch in Settings → Your profile.',
          fr: 'Les e-mails marketing se règlent avec un simple interrupteur dans Paramètres → Votre profil.',
          es: 'Los correos de marketing son un simple interruptor en Ajustes → Tu perfil.',
          pt: 'Os e-mails de marketing são um simples interruptor em Configurações → Seu perfil.',
          ko: '마케팅 이메일은 설정 → 내 프로필에서 켜고 끄는 스위치로 바뀌었습니다.',
        },
      },
    ],
  },
  {
    date: '2026-11-25',
    changes: [
      {
        kind: 'New',
        text: {
          en: 'Live chat: a message-first widget you can embed on your site, with visitor details saved to the contact.',
          fr: 'Chat en direct : un widget centré sur le message à intégrer à votre site, avec les informations du visiteur enregistrées dans le contact.',
          es: 'Chat en vivo: un widget centrado en el mensaje para tu sitio, con los datos del visitante guardados en el contacto.',
          pt: 'Chat ao vivo: um widget focado na mensagem para o seu site, com os dados do visitante salvos no contato.',
          ko: '라이브 채팅: 사이트에 삽입할 수 있는 메시지 중심 위젯이며 방문자 정보가 연락처에 저장됩니다.',
        },
      },
      {
        kind: 'New',
        text: {
          en: 'Flag and searchable country picker on every phone field.',
          fr: 'Sélecteur de pays avec drapeau et recherche sur chaque champ téléphone.',
          es: 'Selector de país con bandera y búsqueda en cada campo de teléfono.',
          pt: 'Seletor de país com bandeira e busca em todos os campos de telefone.',
          ko: '모든 전화번호 입력란에 국기와 검색 가능한 국가 선택기가 추가되었습니다.',
        },
      },
      {
        kind: 'Improved',
        text: {
          en: 'Newest conversations now appear first in the inbox.',
          fr: 'Les conversations les plus récentes apparaissent en premier dans la boîte de réception.',
          es: 'Las conversaciones más recientes aparecen primero en la bandeja.',
          pt: 'As conversas mais recentes aparecem primeiro na caixa de entrada.',
          ko: '받은편지함에서 최신 대화가 맨 위에 표시됩니다.',
        },
      },
      {
        kind: 'Improved',
        text: {
          en: 'Forms list is calmer: single-line rows, with Import inside the New form dialog.',
          fr: 'Liste des formulaires plus sobre : lignes simples, avec l’import dans la fenêtre Nouveau formulaire.',
          es: 'Lista de formularios más limpia: filas de una línea, con Importar dentro del cuadro Nuevo formulario.',
          pt: 'Lista de formulários mais limpa: linhas simples, com Importar dentro da janela Novo formulário.',
          ko: '양식 목록이 한 줄 행으로 간결해졌고 가져오기는 새 양식 창 안으로 옮겨졌습니다.',
        },
      },
      {
        kind: 'Fixed',
        text: {
          en: 'Live chat autofill no longer blocks sending.',
          fr: 'Le remplissage automatique du chat en direct ne bloque plus l’envoi.',
          es: 'El autocompletado del chat en vivo ya no bloquea el envío.',
          pt: 'O preenchimento automático do chat ao vivo não bloqueia mais o envio.',
          ko: '라이브 채팅 자동 완성이 더 이상 전송을 막지 않습니다.',
        },
      },
    ],
  },
]
