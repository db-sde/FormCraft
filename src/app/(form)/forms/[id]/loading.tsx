/** The builder while its draft loads (Part 4 loading state): header,
 * list, canvas and panel placeholders, pulsing together. */
export default function BuilderLoading() {
  const bar = "bg-muted rounded-sm";
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Loading form">
      <div className="border-ink bg-card flex h-16 shrink-0 items-center gap-3 border-b-[1.5px] px-4">
        <span className={`${bar} size-9`} />
        <span className={`${bar} h-5 w-48`} />
        <span className={`${bar} mx-auto hidden h-9 w-80 lg:block`} />
        <span className={`${bar} ml-auto h-9 w-28`} />
      </div>
      <div className="grid min-h-0 flex-1 animate-pulse lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <div className="border-ink bg-card hidden flex-col gap-2 border-r-[1.5px] px-3.5 py-[18px] lg:flex">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`${bar} h-9`} />
          ))}
        </div>
        <div className="bg-board flex flex-col gap-4 p-8">
          <span className="bg-muted h-5 w-[120px] rounded-full" />
          <span className="bg-muted max-h-[520px] flex-1 rounded-lg" />
        </div>
        <div className="border-ink bg-card hidden flex-col gap-3.5 border-l-[1.5px] p-5 lg:flex">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`${bar} h-10`} />
          ))}
        </div>
      </div>
    </div>
  );
}
