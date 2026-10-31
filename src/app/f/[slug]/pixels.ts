/**
 * Analytics and ad pixels on the live form (P2.12, master spec F-44).
 * Only identifiers are stored; each is checked against its exact format
 * again before it goes into the vendor's standard snippet, so no
 * creator-written code ever runs. Answers are never sent — page views
 * (by each vendor's own snippet), one start and one submit.
 */

export type TrackingIds = {
  ga: string | null;
  gtm: string | null;
  meta: string | null;
  linkedin?: string | null;
  linkedinConversion?: string | null;
  tiktok?: string | null;
};

const GA = /^G-[A-Z0-9]{4,12}$/;
const GTM = /^GTM-[A-Z0-9]{4,10}$/;
const META = /^[0-9]{6,20}$/;
const LINKEDIN = /^[0-9]{4,10}$/;
const LINKEDIN_CONVERSION = /^[0-9]{4,12}$/;
const TIKTOK = /^[A-Z0-9]{15,25}$/;

export function safeTrackingIds(ids: Pick<TrackingIds, "ga" | "gtm" | "meta">) {
  return {
    ga: ids.ga && GA.test(ids.ga) ? ids.ga : null,
    gtm: ids.gtm && GTM.test(ids.gtm) ? ids.gtm : null,
    meta: ids.meta && META.test(ids.meta) ? ids.meta : null,
  };
}

export function safeAdIds(ids: TrackingIds) {
  return {
    linkedin: ids.linkedin && LINKEDIN.test(ids.linkedin) ? ids.linkedin : null,
    linkedinConversion:
      ids.linkedinConversion && LINKEDIN_CONVERSION.test(ids.linkedinConversion)
        ? ids.linkedinConversion
        : null,
    tiktok: ids.tiktok && TIKTOK.test(ids.tiktok) ? ids.tiktok : null,
  };
}

export type Snippet = { key: string; src?: string; code?: string };

/** The vendors' standard snippets for the checked ids. */
export function pixelSnippets(ids: TrackingIds): Snippet[] {
  const { ga, gtm, meta } = safeTrackingIds(ids);
  const { linkedin, tiktok } = safeAdIds(ids);
  const out: Snippet[] = [];
  if (ga) {
    out.push({
      key: "fc-ga-lib",
      src: `https://www.googletagmanager.com/gtag/js?id=${ga}`,
    });
    out.push({
      key: "fc-ga",
      code: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga}');`,
    });
  }
  if (gtm) {
    out.push({
      key: "fc-gtm",
      code: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`,
    });
  }
  if (meta) {
    out.push({
      key: "fc-meta",
      code: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');fbq('track','PageView');`,
    });
  }
  if (linkedin) {
    out.push({
      key: "fc-linkedin",
      code: `window._linkedin_partner_id="${linkedin}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(window._linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})(window.lintrk);`,
    });
  }
  if (tiktok) {
    out.push({
      key: "fc-tiktok",
      code: `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tiktok}');ttq.page();}(window,document,'ttq');`,
    });
  }
  return out;
}

/** Which vendor gets what, once per page load each. LinkedIn only has a
 * submit conversion, and only when its conversion id is set. */
export function trackFunction(ids: TrackingIds): string {
  const conversion = safeAdIds(ids).linkedinConversion;
  return (
    `window.formcraftTrack=function(e){try{` +
    `if(e!=='start'&&e!=='submit')return;var done=window.__fcTracked=window.__fcTracked||{};if(done[e])return;done[e]=1;` +
    `if(/[?&]fc_pixel_debug=1/.test(location.search))console.info('[FormCraft pixels]',e,{ga:!!window.gtag,gtm:!!window.google_tag_manager||!!window.dataLayer,meta:!!window.fbq,linkedin:!!window.lintrk,tiktok:!!window.ttq});` +
    `if(window.gtag)window.gtag('event',e==='start'?'form_start':'form_submit');` +
    `if(window.dataLayer)window.dataLayer.push({event:e==='start'?'formcraft_start':'formcraft_submit'});` +
    `if(window.fbq&&e==='submit')window.fbq('track','Lead');` +
    (conversion
      ? `if(window.lintrk&&e==='submit')window.lintrk('track',{conversion_id:${conversion}});`
      : "") +
    `if(window.ttq)window.ttq.track(e==='start'?'FormStart':'SubmitForm');` +
    `}catch(_){}};`
  );
}
