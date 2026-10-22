export function Screen({ title, note }: { title: string; note?: string }) {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {note && <p className="text-muted-foreground mt-1 text-sm">{note}</p>}
    </div>
  )
}
