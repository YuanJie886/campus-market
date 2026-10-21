import { Text, View } from '@tarojs/components';
import type { TextbookEdition } from '../../model';
import { editionLines } from '../../catalog';

/** 版本的完整身份：书名、版次、ISBN、作者、出版社。不能只写「高数教材」。 */
export function EditionSummary({ edition }: { edition: Pick<TextbookEdition, 'title' | 'editionLabel' | 'isbn' | 'authors' | 'publisher' | 'publishedYear' | 'subtitle'> }) {
  return <View>
    <Text className='req-name'>{edition.title} <Text className='brand-text'>{edition.editionLabel}</Text></Text>
    {edition.subtitle ? <Text className='muted sheet-line'>{edition.subtitle}</Text> : null}
    {editionLines(edition).map((line) => <Text key={line} className='muted sheet-line'>{line}</Text>)}
  </View>;
}
