export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-10 w-2/3" />
      <div className="skeleton h-5 w-1/2" />
      <div className="skeleton mt-4 h-40 w-full" />
    </div>
  );
}
