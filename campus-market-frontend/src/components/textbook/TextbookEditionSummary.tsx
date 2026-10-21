import type { TextbookEdition } from '../../api/contracts';
import { formatIsbn } from '../../utils/isbn';

/** 版本的完整身份：书名、版次、ISBN、作者、出版社。不能只写「高数教材」。 */
export default function TextbookEditionSummary({ edition, headingLevel = 3 }: {
  edition: Pick<TextbookEdition, 'title' | 'editionLabel' | 'isbn' | 'authors' | 'publisher' | 'publishedYear' | 'subtitle'>;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <div>
      <Heading className="text-sm font-bold text-slate-800">
        {edition.title} <span className="font-semibold text-teal-800">{edition.editionLabel}</span>
      </Heading>
      {edition.subtitle && <p className="text-xs text-slate-600">{edition.subtitle}</p>}
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-slate-700">
        <dt>ISBN</dt><dd>{formatIsbn(edition.isbn)}</dd>
        <dt>作者</dt><dd>{edition.authors.join('、')}</dd>
        <dt>出版社</dt><dd>{edition.publisher}{edition.publishedYear ? ` · ${edition.publishedYear} 年` : ''}</dd>
      </dl>
    </div>
  );
}
