import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PhaseChipUi } from '@/lib/roomPhases';

/**
 * Central UI strings (Norwegian) for Shepherd pilot on construction sites.
 * Keys are English identifiers; values are short, mobile-friendly Norwegian.
 */
const DICTIONARY = {
  // Shell / nav
  projects: 'Prosjekter',
  sites: 'Prosjekter',
  today: 'I dag',
  site: 'Prosjekt',
  searchProjects: 'Søk i prosjekter…',
  searchFloorsAndRooms: 'Søk etasje og rom…',
  findSite: 'Finn prosjekt…',
  findRoom: 'Finn rom…',
  searchProjectsAria: 'Søk prosjekter',
  searchFloorsAndRoomsAria: 'Søk etasjer og rom',
  findSiteAria: 'Finn prosjekt',
  findRoomAria: 'Finn rom',
  loading: 'Laster…',
  loadingFloors: 'Laster etasjer…',
  project: 'Prosjekt',
  noMatches: 'Ingen treff',
  adminSettings: 'Admin',
  lightMode: 'Lys modus',
  darkMode: 'Mørk modus',
  logOut: 'Logg ut',
  dashboard: 'Oversikt',
  checklist: 'Sjekkliste',
  save: 'Lagre',
  delete: 'Slett',
  uploadPhoto: 'Last opp bilde',
  deadline: 'Frist',
  workerNavHome: 'Hjem',
  workerNavWork: 'Rom',
  workerNavSearch: 'Søk',
  workerNavSettings: 'Innstillinger',
  workerNavRoom: 'Rom',
  homeNav: 'Hjem',
  ariaWorkerNav: 'Montørnavigasjon',
  ariaAppNav: 'Appnavigasjon',

  // Worker home (WorkerTodayView)
  loggedInAs: 'Innlogget som',
  roomsWithOpenWork: 'rom med åpen jobb',
  loadProjectsFailedTitle: 'Klarte ikke laste prosjekter',
  loadProjectsFailedHint: 'Sjekk nett og prøv igjen. Økten er fortsatt aktiv.',
  retry: 'Prøv igjen',
  noProjectsYet: 'Ingen prosjekter ennå',
  noSitesYet: 'Ingen anlegg ennå',
  projectListStale: 'Prosjektlisten kan være utdatert (siste oppdatering feilet).',
  refresh: 'Oppdater',
  siteLabel: 'Prosjekt:',
  otherSites: 'Andre prosjekter',
  currentSite: 'Aktiv',
  continueWork: 'Fortsett arbeid',
  loadingRooms: 'Laster rom…',
  checklistProgressUnavailable:
    'Kunne ikke laste sjekkliste-fremdrift. Du kan fortsatt åpne rom nedenfor.',
  roomPrefix: 'Rom',
  continue: 'Fortsett',
  start: 'Start',
  continueHandoff: 'Fortsett overlevering',
  handoffShort: 'Overlevering',
  openRoom: 'Åpne rom',
  inProgressLabel: 'Pågår',
  anotherReadyRoom: 'Et annet klart rom',
  blockedLabel: 'Sperret',
  blockedRoomSingular: '{n} sperret rom',
  blockedRoomPlural: '{n} sperrede rom',
  openToSeeWhy: 'Åpne for å se hvorfor',
  finishedToday: 'Ferdig i dag',
  myAssignedPhases: 'Mine faser',
  noAssignedPhases: 'Ingen tildelte faser',
  phaseShort: 'Fase:',
  findRoomSection: 'Finn rom',
  searchRoomAria: 'Søk på romnummer',
  roomSearchPlaceholder: 'Romnummer eller prosjekt',
  allRooms: 'Alle rom',
  noMatchingRooms: 'Ingen treff',
  noRoomsReadyYet:
    'Ingen rom er klare ennå. Velg et rom nedenfor eller åpne prosjektlisten.',
  openSite: 'Åpne prosjekt',
  signInPinRequired: 'Logg inn (PIN kreves)',
  setNameOnChecklistHint: 'Sett navnet ditt på et sjekkpunkt',
  loginFallbackWorker: 'Montør',

  // Worker trust / status lines
  statusBlocked: 'Sperret',
  statusNeedsHandoff: 'Trenger overlevering',
  statusReadyToStart: 'Klar til start',
  statusCompleted: 'Ferdig',
  lastWorkedToday: 'Sist jobbet her i dag',
  lastWorkedYesterday: 'Sist jobbet her i går',
  lastWorkedDaysAgo: 'Sist aktivitet for {n} dager siden',
  statusInProgress: 'Pågår',
  statusReadyForWork: 'Klar for arbeid',
  workedHereToday: 'Jobbet her i dag',
  workedHereYesterday: 'Jobbet her i går',
  lastActivityDaysAgo: 'Sist aktivitet for {n} dager siden',
  yourLastOpenedRoom: 'Sist åpnede rom',
  needsHandoffShort: 'Trenger overlevering',
  sameRoomAsBefore: 'Samme rom som før',
  taskMarkedProgress: '{done}/{total} avmerket',
  taskOpenProgress: '{done}/{total} åpne',

  // Worker settings / login
  workerMeLoggedIn: 'Innlogget som',
  workerMeAppAccount: 'App-konto',
  workerMeNotPinHint: '(ikke montør-PIN).',
  workerMeSessionLabel: 'Økt:',
  switchUserDev: 'Bytt bruker',
  siteWorkerPinCard: 'Montør (PIN)',
  sessionEndsFull:
    'Økta utløper {time}. Ca. {h} timer på denne enheten — bruk PIN på nytt etterpå, eller logg ut.',
  pinSessionShort: 'Midlertidig PIN-økt på denne enheten (ca. {h} timer).',
  switchWorker: 'Bytt montør',
  logOutPin: 'Logg ut',
  workerLoginTitle: 'Montørinnlogging',
  workerLoginIntro:
    'Skriv inn prosjektnummer fra basen og PIN. Etter innlogging forblir denne enheten innlogget i ca. {h} timer — du trenger ikke PIN på nytt før økta utløper eller du logger ut.',
  projectNumber: 'Prosjektnummer',
  projectNumberPlaceholder: 'Fra basen',
  pinLabel: 'PIN',
  signingIn: 'Logger inn…',
  signIn: 'Logg inn',
  backToHome: 'Tilbake til forsiden',
  toastInvalidProject: 'Oppgi gyldig prosjektnummer.',
  toastPinTooShort: 'PIN må være minst 4 tegn.',
  toastWrongPin: 'Feil PIN. Prøv igjen.',
  toastNetworkError: 'Nettverksfeil',
  toastSignedInAs: 'Innlogget som {name}',

  // Room breadcrumb / nav
  ariaLocation: 'Plassering',
  floorFallback: 'Etasje',
  previousRoom: 'Forrige rom',
  previousRoomShort: 'Forrige',
  nextRoom: 'Neste rom',
  nextRoomShort: 'Neste',
  nextRoomWorkerHint: 'Gå til neste rom',
  noPreviousRoom: 'Ingen forrige rom',
  noNextRoom: 'Ingen neste rom',
  navRoomListUnavailable: 'Romliste utilgjengelig',
  navCannotDeterminePosition: 'Kunne ikke finne plassering på etasjen',
  navFirstRoomFloor: 'Første rom på etasjen',
  navLastRoomFloor: 'Siste rom på etasjen',

  // Dashboard cards / stats
  statTotal: 'Totalt',
  statCompleted: 'Ferdig',
  statInProgress: 'Pågår',
  statInspection: 'Kontroll',
  statBlocked: 'Sperret',
  overallProgress: 'Samlet fremdrift',
  heatingDocSection: 'Varmekabel-dokumentasjon',
  heatingDocBlurb:
    'Rom der arbeidsflyten inkluderer varmekabel. Status bygger på de tre måletrinnene (og synlige ekstratrinn).',
  roomsInScope: 'Rom i omfang',
  heatingComplete: 'Fullført',
  heatingPartialDoc: 'Delvis dokumentert',
  heatingMissingDoc: 'Mangler dokumentasjon',
  heatingIssues: 'Avvik / oppmerksomhet',
  filterRooms: 'Filtrer rom',
  filterAll: 'Alle',
  filterIncomplete: 'Ufullstendig',
  filterMissingDoc: 'Mangler dok.',
  heatingEmptyWorkflow:
    'Ingen rom i dette prosjektet krever varmekabel-dokumentasjon med denne flyten.',
  heatingEmptyFilter: 'Ingen rom passer filteret.',
  floorSummaryRooms: 'rom',
  floorSummaryComplete: 'ferdig',
  floorSummaryIncomplete: 'ikke ferdig',
  floorSummaryMissingDoc: 'mangler dok.',
  floorSummaryIssues: 'avvik',
  tableRoom: 'Rom',
  tableStatus: 'Status',
  tableMissingStages: 'Mangler trinn',
  tableLastUpdated: 'Sist oppdatert',
  tableRecordedBy: 'Utført av',
  tableLocked: 'Låst',
  phaseColumnPrefix: 'Fase ·',
  cardDue: 'Frist',
  oneChecklistPointLeft: '1 punkt gjenstår',
  nChecklistPointsLeft: '{n} punkter gjenstår',
  cardHeatingCable: 'Varmekabel:',
  cardUpdated: 'Oppdatert',
  ariaLockedViewOnly: 'Låst — kun visning for montører',
  ariaBlocked: 'Sperret',

  statusCardBlocked: 'Sperret',
  statusCardNotStarted: 'Ikke startet',
  statusCardInProgress: 'Pågår',
  statusCardCompleted: 'Ferdig',

  // Worker room view (shared)
  takePhoto: 'Ta bilde',
  chooseGallery: 'Velg fra album',
  noReadingsYet: 'Ingen målinger ennå',
  heroComplete: 'Fullført',
  heroActive: 'Aktiv',
  heroBlocked: 'Sperret',
  heroPending: 'Venter',
  phaseHandedOffTitle: 'Fase overlevert',
  phaseHandedOffBody:
    'Låst etter montør-signering. Sjekkliste, dokumentasjon, bilder og notater for denne fasen er skrivebeskyttet til admin låser opp.',
  phasesHeading: 'Faser',
  blockersHeading: 'Hindringer',
  openIssuesCount: '{n} åpent avvik',
  openIssuesCountPlural: '{n} åpne avvik',
  areaHeading: 'Sone',
  anotherPhase: 'Annen fase',
  inProgressColon: 'Pågår:',
  moveToCurrentPhase: 'Gå til aktiv fase',
  hideDetails: 'Skjul detaljer',
  viewDetails: 'Vis detaljer',
  usingSavedName: 'Bruker lagret navn',
  clear: 'Fjern',
  noTasksThisPhase: 'Ingen punkter i denne fasen.',
  taskCompleted: 'Fullført',
  documentationShort: 'Dok.',
  checklistProgressShort: 'Sjekkliste',
  workerRoomsPageTitle: 'Rom',
  checklistCountsUnavailable: 'Sjekkliste-tall utilgjengelig — romlisten fungerer likevel.',
  loadSitesFailedTitle: 'Klarte ikke laste anlegg',
  compactChecklistProgress: 'Sjekkliste {done}/{total} avmerket',
  compactHeatingDocLine: 'Dokumentasjon {complete}/{total}',
  dueWord: 'Frist',
  overdue: 'For sen',
  openWork: 'Åpen jobb',
  doneFraction: '{done}/{total} fullført',
  documentedFraction: '{done}/{total} dokumentert',
  nothingQueuedPhase: 'Ingenting i kø denne fasen',
  heatingDocProgressLabel: 'Dokumentasjon',
  documentationComplete: 'Dokumentasjon komplett',
  allChangesSaved: 'Alt lagret',
  documentationPhotoForStage: 'Dokumentasjonsbilde for dette trinnet',
  completedByLabel: 'Fullført av:',
  uncheckedByLabel: 'Ikke avmerket av',
  otherPhasePhotos: 'Andre fasebilder',
  otherPhasePhotosHint:
    'Valgfritt dokumentasjon for dette steget — ikke for varmekabel-registrering.',
  addPhoto: 'Legg til bilde',
  heatingCableHeading: 'Varmekabel',
  savingShort: 'Lagrer…',
  saveFailedShort: 'Feilet',
  savedShort: 'Lagret',
  heatingGalleryHint: 'Lagrede bilder vises i varmekabel-galleriet under.',
  noteOptionalPlaceholder: 'Notat (valgfritt)',
  timeLabelShort: 'Tid:',
  unknownPerformer: 'Ukjent',
  unknownTimeShort: 'ukjent tid',
  phasePhotosCount: '{n} fasebilde',
  phasePhotosCountPlural: '{n} fasebilder',
  reportedIssuesCount: '{n} rapportert avvik',
  reportedIssuesCountPlural: '{n} rapporterte avvik',
  activityEntriesCount: '{n} aktivitet',
  activityEntriesCountPlural: '{n} aktiviteter',
  workerBlocked: 'Sperret',
  workerHandedOff: 'Overlevert',
  workerReady: 'Klar',
  workerInProgressStatus: 'Pågår',
  workerDecisionReady: 'Klar',
  badgeHandedOff: 'Overlevert',
  badgeBlocked: 'Sperret',
  badgeLocked: 'Låst',
  badgeCompleted: 'Fullført',
  badgeNotStarted: 'Ikke startet',
  badgeInProgress: 'Pågår',
  descHandoffLock: 'Låst etter montør-signering — kun gjennomgang til admin låser opp.',
  descBlockedReadonly: 'Venter på status — kun lesing under.',
  descWaitingAccess: 'Venter på tilgang.',
  descViewOnlyPhase: 'Kun visning for denne fasen.',
  descRecordedReference: 'Arkivert som referanse.',
  descWorkOnOtherPhase: 'Arbeid på en annen fase.',
  heatingConfirmMustLogin: 'Du må være innlogget som montør for å bekrefte dette trinnet.',

  cancel: 'Avbryt',
  close: 'Lukk',
  confirm: 'Bekreft',
  back: 'Tilbake',
  edit: 'Rediger',
  add: 'Legg til',
  uploading: 'Laster opp…',
  deleting: 'Sletter…',

  // Toasts & messages (RoomDetail + shared)
  toastFailedLoad: 'Kunne ikke laste',
  toastLockedForWorkers: 'Låst for montører',
  toastUnlocked: 'Låst opp',
  toastFailedUpdateLock: 'Kunne ikke oppdatere lås',
  toastStatusUpdated: 'Status oppdatert',
  toastFailedUpdateStatus: 'Kunne ikke oppdatere status',
  toastBlockedReasonRequired: 'Årsak ved sperring må fylles inn',
  toastRoomBlocked: 'Rommet er markert som sperret',
  toastFailedBlockRoom: 'Kunne ikke sperre rom',
  toastPinToCheck: 'Logg inn som montør (PIN) for å krysse av.',
  toastFailedUpdateTask: 'Kunne ikke oppdatere punkt',
  taskVerbChecked: 'avmerket',
  taskVerbUnchecked: 'fjernet avmerking på',
  toastSavedNameCleared: 'Lagret navn fjernet',
  toastBulkItemsAdded: '{n} punkter lagt til',
  toastItemAdded: 'Punkt lagt til',
  toastFailedAddItem: 'Kunne ikke legge til punkt',
  toastItemsAdded: 'punkter lagt til',
  toastFailedAddItems: 'Kunne ikke legge til punkter',
  toastItemRemoved: 'Punkt fjernet',
  toastFailedRemoveItem: 'Kunne ikke fjerne punkt',
  toastItemNameUpdated: 'Navn oppdatert',
  toastFailedUpdateItemName: 'Kunne ikke oppdatere navn',
  toastFailedSaveDeviations: 'Kunne ikke lagre avvik',
  toastPinToReport: 'Logg inn som montør (PIN) for å melde avvik.',
  toastEnterNameFirst: 'Skriv inn navn først — trykk på et sjekkpunkt én gang for å sette navn.',
  toastPhaseAssignmentCleared: 'Fase-tildeling fjernet',
  toastWorkerAssignedPhase: 'Montør tildelt fase',
  toastFailedAssignPhase: 'Kunne ikke tildele montør til fase',
  toastMainPhase: 'Hovedfase:',
  toastAreaPhase: 'Sonefase:',
  toastFailedSetMainPhase: 'Kunne ikke sette hovedfase',
  toastFailedSetAreaPhase: 'Kunne ikke sette sonefase',
  toastPhaseStatusUpdated: 'Fasestatus oppdatert',
  toastFailedPhaseStatus: 'Kunne ikke oppdatere fasestatus',
  toastPhaseLockedWorkers: 'Fase låst for montører',
  toastPhaseOpenWorkers: 'Fase åpen for montører',
  toastFailedPhaseLock: 'Kunne ikke oppdatere faselås',
  toastAreaAdded: 'Sone lagt til',
  toastFailedAddArea: 'Kunne ikke legge til sone',
  toastAreaRenamed: 'Sone omdøpt',
  toastFailedRenameArea: 'Kunne ikke omdøpe sone',
  toastCannotRemovePrimaryArea: 'Kan ikke fjerne hovedsonen',
  toastAreaRemoved: 'Sone fjernet',
  toastFailedRemoveArea: 'Kunne ikke fjerne sone',
  toastPhotoUploaded: 'Bilde lastet opp',
  toastFailedUploadPhoto: 'Kunne ikke laste opp bilde',
  toastPhotoDeleted: 'Bilde slettet',
  toastFailedDeletePhoto: 'Kunne ikke slette bilde',
  toastDeleted: 'Slettet',
  toastFailedDelete: 'Kunne ikke slette',
  toastPinToHandoff: 'Logg inn som montør (PIN) for å registrere overlevering.',
  toastNameToHandoff: 'Skriv inn navn for å registrere overlevering.',
  toastPhaseHandedOffOk: 'Fase overlevert og låst for redigering.',
  toastDeadlineSaved: 'Frist lagret',
  toastDeadlineCleared: 'Frist fjernet',
  toastFailedDeadline: 'Kunne ikke lagre frist',
  toastFailedPhaseTools: 'Kunne ikke lagre verktøy for fase',
  toastTitleUpdated: 'Tittel oppdatert',
  toastFailedTitle: 'Kunne ikke lagre tittel',
  toastHeatingSaved: 'Varmekabel-dokumentasjon lagret',
  toastFailedSaveHeating: 'Kunne ikke lagre varmekabel-dokumentasjon',
  toastFailedSavePrefix: 'Kunne ikke lagre',
  toastHeatingPhotoUploaded: 'Varmekabelbilde lastet opp',
  toastFailedHeatingPhoto: 'Kunne ikke laste opp varmekabelbilde',
  toastCompletePrevStep: 'Fullfør forrige trinn først.',
  toastStepAlreadyLocked: 'Dette trinnet er allerede låst.',
  toastFillRequiredFields: 'Fyll alle obligatoriske felt før fullføring.',
  toastPhotoRequiredAfterCable: 'Legg til minst ett bilde før «Etter kabel lagt» er fullført.',
  toastMustBeWorkerConfirm: 'Du må være innlogget som montør for å bekrefte dette trinnet.',
  toastStepCompletedLocked: 'Trinn fullført og låst',
  toastFailedConfirmHeatingStep: 'Kunne ikke bekrefte varmekabeltrinn',
  toastStepUnlocked: 'Trinn låst opp. Montører kan redigere til det bekreftes på nytt.',
  toastFailedUnlockStep: 'Kunne ikke låse opp trinn',
  toastHeatingSectionLocked: 'Varmekabel-seksjon låst',
  toastHeatingSectionUnlocked: 'Varmekabel-seksjon låst opp',
  toastFailedHeatingLock: 'Kunne ikke oppdatere lås for varmekabel',
  toastNameBeforeResolve: 'Sett navn før du løser avvik.',
  toastProjectNotFound: 'Fant ikke prosjektet.',

  bulkItemsWillBeAdded: 'punkter vil bli lagt til',
  bulkAdding: 'Legger til…',
  bulkAddButton: 'Legg til',
  bulkAddDialogTitle: 'Legg til flere sjekkpunkter',
  bulkAddDialogHint: 'Ett punkt per linje. Alle legges til på sjekklisten.',
  bulkAddExamplesPlaceholder:
    'Kabeltrasé\nSette veggbokser\nLegge varmekabel\nMontere utstyr\nTesting\nSluttkontroll',
  bulkAddButtonWithCount: 'Legg til {n} punkter',
  imagePreviewAlt: 'Forhåndsvisning',

  newChecklistItemPlaceholder: 'Nytt sjekkpunkt…',
  addDeviationPlaceholder: 'Legg til avvik…',
  newAreaNamePlaceholder: 'Nytt sonenavn',
  blockedReasonPlaceholder: 'Årsak (f.eks. venter på rørlegger)',
  workerNameExamplePlaceholder: 'f.eks. Ola Nordmann',

  optionalNoteDeviation: 'Valgfritt notat / avvik',
  extraStepNamePlaceholder: 'Ekstra trinn (f.eks. før termostat kobles)',
  selectStatus: 'Status',

  roomWord: 'Rom',
  floorWord: 'Etasje',

  statusWorkflowNotStarted: 'Ikke startet',
  statusWorkflowInProgress: 'Pågår',
  statusWorkflowInspection: 'Klar til kontroll',
  statusWorkflowCompleted: 'Ferdig',
  statusWorkflowBlocked: 'Sperret',

  extraStepFallback: 'Ekstra trinn {n}',

  // Phase workflow chips (floor board)
  phaseChipActive: 'Pågår',
  phaseChipOpen: 'Åpen',
  phaseChipLocked: 'Låst',
  phaseChipCompleted: 'Fullført',
  phaseChipNotStarted: 'Ikke startet',
  phaseChipBlocked: 'Sperret',
  phaseChipTasksMissing: '{n} mangler',

  gjeldendeTrinnPrefix: 'Gjeldende trinn:',
  allStagesDocumentedShort: 'Alle trinn dokumentert.',
  heatingLockedByAdminViewOnly: 'Låst av admin — kun visning.',
  heatingBadgeReopened: 'Opplåst',
  heatingConfirmPrevStepFirst: 'Fullfør og lås forrige trinn før du redigerer dette.',
  heatingRetrySave: 'Prøv lagring på nytt',
  heatingCablePhotosTitle: 'Varmekabelbilder',
  heatingGalleryTapHint:
    'Trykk et miniatyr for full størrelse. Bildetekster viser trinn og opplaster når det finnes.',
  photosOtherThisPhaseTitle: 'Andre bilder denne fasen',
  photosThisPhaseTitle: 'Bilder denne fasen',
  phasePhotosReadonlyGeneralHint:
    'Oppsummering av generelle opplastinger — varmekabel ligger i galleriet over.',
  phasePhotoFallback: 'Fasebilde',

  measurementsSectionHeading: 'Målinger',
  measurementsResistance: 'Motstand',
  measurementsInsulation: 'Isolasjon',
  ariaResistanceOhm: 'Motstand (Ω)',
  ariaInsulationMohm: 'Isolasjon (MΩ)',
  noteOptionalLabel: 'Notat (valgfritt)',

  heatingConfirmCompletePrevFirst: 'Fullfør forrige trinn før du bekrefter dette.',
  heatingConfirmFillResistance: 'Fyll inn motstand før bekreftelse.',
  heatingConfirmFillInsulation: 'Fyll inn isolasjon før bekreftelse.',
  heatingConfirmPhotoCableStep: 'Legg til minst ett bilde før bekreftelse av dette trinnet.',

  dialogConfirmStepTitle: 'Bekreft trinn',
  dialogConfirmStepBody:
    'Er du sikker på at du vil bekrefte dette trinnet? Klienten registrerer tidspunkt og innlogget montør.',
  confirmingShort: 'Bekrefter…',
  confirmStepButton: 'Bekreft trinn',

  dialogConfirmPhaseHandoffTitle: 'Bekreft faseoverlevering',
  dialogConfirmPhaseHandoffIntro: 'Du bekrefter at arbeidet i',
  dialogConfirmPhaseHandoffTail: 'er fullført og korrekt på stedet.',
  dialogPhaseHandoffBulletLock:
    'Denne fasen låses — du kan ikke endre sjekkliste eller varmekabel-dokumentasjon her lenger.',
  dialogPhaseHandoffBulletNext:
    'Overlevering registreres for admin. Tavlen går videre til {next} når prosjektet flyttes.',
  dialogPhaseHandoffBulletLast:
    'Overlevering registreres for admin. Dette var siste steg i flyten for dette rommet.',
  recordingShort: 'Registrerer…',
  confirmHandoffButton: 'Bekreft overlevering',
  markPhaseCompleteCta: 'Marker fase som fullført',

  moreOnPhaseSection: 'Mer om denne fasen',
  reportIssueLink: 'Meld avvik',
  activityHistoryHeading: 'Historikk',
  noOpenIssuesThisPhase: 'Ingen åpne avvik i denne fasen.',
  resolvedSectionCount: 'Løst ({n})',
  deviationDescribePlaceholder: 'Beskriv avviket…',
  reportedByPrefix: 'Rapportert av',
  markIssueResolved: 'Merk som løst',
  resolvedByPrefix: 'Løst av',
  nothingLoggedPhaseYet: 'Ingenting logget i denne fasen ennå.',
  latestBadge: 'Siste',

  manageAreasButton: 'Administrer',
  assignWorkerMenuLabel: 'Tildel montør',
  menuPhaseOpenWorkers: 'Åpen for montører',
  menuPhaseLockWorkers: 'Låst for montører',
  workerUnassigned: 'Ikke tildelt',
  workerCurrentSuffix: '(nåværende)',
  phaseAriaActionsFor: 'Handlinger for fase {phase}',
  viewingPhaseVsBoard: 'Ser på {viewing} — tavlefase er {board}.',
  goToBoardPhase: 'Gå til tavlefase',
  notBoardPhaseTabEditHint:
    'Ikke tavlefane, men fortsatt åpen for redigering hvis rollen din tillater det.',
  phaseBannerReadOnlyLocked: 'Låst — kun visning',
  phaseBannerReadOnly: 'Skrivebeskyttet',
  phaseReadOnlyIntro:
    'Denne fasen er lukket for redigering på kontoen din. Historikk vises under.',
  checklistShortDone: 'Sjekkliste:',
  doneWord: 'avmerket',
  photosShortLabel: 'Bilder:',
  cableDocsShortLabel: 'Varmekabel:',
  completedItemsHeading: 'Fullførte punkter',
  moreItemsPlus: '+{n} flere',
  noChecklistMarkedComplete: 'Ingen sjekkpunkter er avmerket i denne fasen.',
  phaseUnlockNeedsAdminHint:
    'Opplåsing og flytting i flyten krever admin — kontakt ved behov.',

  heatingDocRoomHeading: 'Varmekabel-dokumentasjon',
  heatingReadOnlyIntroLine: 'Registrerte målinger og modulbilder — kun visning for din rolle.',
  noMeasurementsOrPhotos: 'Ingen målinger eller bilder registrert.',
  completedAtLabel: 'Fullført:',
  heatingCompletedByLabel: 'Utført av:',
  heatingDateLabel: 'Dato:',
  heatingPerformedByLabel: 'Registrert av:',
  unlockStepButton: 'Lås opp trinn',
  stagePhotosLabel: 'Trinnbilder',
  stagePhotoCountOne: '{n} trinnbilde',
  stagePhotoCountMany: '{n} trinnbilder',
  galleryPickShort: 'Album',
  removeExtraStep: 'Fjern',
  noPhotosThisPhaseEmpty: 'Ingen bilder i denne fasen',
  noActivityPhaseYet: 'Ingen aktivitet i denne fasen ennå.',

  deviationsNotesHeading: 'Avvik / notater',
  deviationsMetaOpenOnly: '{open} åpne',
  deviationsMetaResolvedOnly: '{n} løst',
  deviationsIntroHint: 'Avvik og mangler — ikke chat. Kun denne fasen.',

  activityActorUnknown: 'Ukjent',

  // Print export (project heating summary HTML)
  exportMeasurementsHeading: 'Målinger og registrering',
  exportTableStep: 'Trinn',
  exportTableResistance: 'Motstand (Ω)',
  exportTableInsulation: 'Isolasjon (MΩ)',
  exportTableRegistered: 'Registrert',
  exportTableConfirmedBy: 'Bekreftet av',
  exportTablePhotos: 'Bilder',
  exportPhotoDocumentation: 'Bildedokumentasjon',
  exportNoPhotosRoom: 'Ingen bilder lastet opp for dette rommet.',
  exportProjectLabel: 'Prosjekt:',
  exportLocationLabel: 'Plassering:',
  exportDocWindowTitle: 'Varmekabel-dokumentasjon – {name}',
  exportUploadedByStrong: 'Lastet opp av:',
  exportRecordedStrong: 'Registrert:',
  exportFigureRoomStrong: 'Rom:',
  exportFigureStepStrong: 'Trinn:',
  exportSelectRoomsFirst: 'Velg minst ett rom',
  exportFloorNumbered: 'Etasje {n}',
  exportRoomTitlePlain: 'Rom {number}',
  exportRoomLocationJoin: '{floor} · Rom {room}',

  toastDeviationAdded: 'Avvik lagt til',
  toastIssueResolvedMark: 'Avvik markert som løst',
  toastIssueReopened: 'Avvik gjenåpnet',

  heatingDocFillStagesHint: 'Fyll ut alle tre måletrinn for komplett dokumentasjon.',
  heatingLockedAdminEditableHint: 'Låst av admin. Montører ser kun — admin kan fortsatt korrigere.',
  adminHeatingLockButton: 'Lås',
  adminHeatingUnlockButton: 'Lås opp',
  removeItemAria: 'Fjern punkt',

  addExtraHeatingStep: 'Legg til ekstra trinn',
  missingHeatingStagesPrefix: 'Mangler trinn:',
  missingHeatingStagesNone: 'Ingen',

  phaseToolsCardTitle: 'Faseverktøy (dette rommet)',
  phaseToolsCardHint:
    'Sjekkliste og varmekabel per fase for montører. Prosjektstandard gjelder om du ikke overstyrer — å skjule et verktøy sletter ikke data.',
  checklistToolCheckbox: 'Sjekkliste',

  floorBoardHintShort:
    'Fanen som matcher etasjetavlen er uthevet. Under velger du hvilken fase du redigerer.',
  boardPhaseSelectLabel: 'Tavlefase',
  areaPhaseSelectLabel: 'Sonefase',
  workflowStepStatusHeading: 'Status per trinn',
  workflowParallelStepsHint:
    'Flere trinn kan være «Pågår» samtidig. Tavlefase-kontrollen over gir en enkel lineær progresjon når du trenger det.',

  photoSectionHeading: 'Bilder',
  reopenIssue: 'Gjenåpne',
  noChecklistItemsThisPhase: 'Ingen sjekkpunkter i denne fasen.',

  areasDialogTitle: 'Sonar',
  areasDialogHint:
    'Hver sone har egen flyt og sjekkliste. Første sone styrer tavlefase for dette rommet.',

  roomNotFoundShort: 'Ikke funnet',
  areaPrimaryBadge: 'Hoved',
  areasRemoveZone: 'Fjern',
  areasDialogDone: 'Ferdig',

  dialogBlockRoomTitle: 'Sperr rom',
  dialogMarkRoomBlocked: 'Merk som sperret',

  dialogDeleteRoomTitle: 'Slette dette rommet?',
  dialogDeleteRoomBody:
    'Dette sletter rommet permanent sammen med sjekkliste, bilder, besøk og notater.',

  checkNameDialogTitle: 'Hvem krysser av?',
  checkNameDialogIntro:
    'Arbeid på byggeplass må knyttes til navn. Skriv navn én gang på denne enheten (lagres lokalt), logg inn med montør-PIN, eller sett navn på profilen.',
  knownWorkersLabel: 'Kjente montører:',
  continueAction: 'Fortsett',

  heatingManualSaveChanges: 'Lagre endringer',
  heatingManualSaveDocumentation: 'Lagre dokumentasjon',
} as const;

export type TranslationKey = keyof typeof DICTIONARY;

export type TranslateFn = (key: TranslationKey) => string;

type I18nContextValue = {
  t: TranslateFn;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

/** Replace `{name}`-style placeholders in translated strings. */
export function formatNb(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** Norwegian label for phase chip status (internal enum stays English for styling). */
export function translatePhaseChipStatus(status: PhaseChipUi['status'], t: TranslateFn): string {
  switch (status) {
    case 'Active':
      return t('phaseChipActive');
    case 'Open':
      return t('phaseChipOpen');
    case 'Locked':
      return t('phaseChipLocked');
    case 'Completed':
      return t('phaseChipCompleted');
    case 'Not started':
      return t('phaseChipNotStarted');
    case 'Blocked':
      return t('phaseChipBlocked');
    default:
      return status;
  }
}

/** Localize chip progress like `3 missing` → `3 mangler`. */
export function translatePhaseChipProgress(progress: string, t: TranslateFn): string {
  const m = /^(\d+) missing$/.exec(progress.trim());
  if (m) return formatNb(t('phaseChipTasksMissing'), { n: Number(m[1]) });
  return progress;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const value = useMemo<I18nContextValue>(
    () => ({
      t: (key) => DICTIONARY[key] ?? key,
    }),
    []
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
