import Script from "next/script";

/**
 * Analytics and ad pixels on the live form (P2.12). Only identifiers are
 * stored; each is checked against its exact format again here before it
 * goes into the vendor's standard snippet, so no creator-written code
 * ever runs. Answers are never sent — only page views, a start and a
 * submit (fired by the runtime through `formcraftTrack`).
 */
export type TrackingIds = {
  ga: string | null;
  gtm: string | null;
  meta: string | null;
};

const GA = /^G-[A-Z0-9]{4,12}$/;
const GTM = /^GTM-[A-Z0-9]{4,10}$/;
const META = /^[0-9]{6,20}$/;

export function safeTrackingIds(ids: TrackingIds): TrackingIds {
  return {
    ga: ids.ga && GA.test(ids.ga) ? ids.ga : null,
    gtm: ids.gtm && GTM.test(ids.gtm) ? ids.gtm : null,
    meta: ids.meta && META.test(ids.meta) ? ids.meta : null,
  };
}

export function TrackingScripts({ ids }: { ids: TrackingIds }) {
  const { ga, gtm, meta } = safeTrackingIds(ids);
  if (!ga && !gtm && !meta) return null;
  return (
    <>
      {ga && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga}`}
            strategy="afterInteractive"
          />
          <Script id="fc-ga" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga}');`}
          </Script>
        </>
      )}
      {gtm && (
        <Script id="fc-gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
        </Script>
      )}
      {meta && (
        <Script id="fc-meta" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');fbq('track','PageView');`}
        </Script>
      )}
      <Script id="fc-track" strategy="afterInteractive">
        {`window.formcraftTrack=function(e){try{if(window.gtag)window.gtag('event',e==='start'?'form_start':'form_submit');if(window.dataLayer)window.dataLayer.push({event:e==='start'?'formcraft_start':'formcraft_submit'});if(window.fbq&&e==='submit')window.fbq('track','Lead');}catch(_){}};`}
      </Script>
    </>
  );
}
