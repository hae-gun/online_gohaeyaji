/** True when the last syllable has a final consonant (받침). Latin words: rough guess by ending. */
export function hasBatchim(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return /[lmnr]$/i.test(word);
  return (c - 0xac00) % 28 !== 0;
}

const JOSA = { 은: ['은', '는'], 이: ['이', '가'], 을: ['을', '를'] };

/**
 * Fills {k}, {k은}, {k이}, {k을} in a template with the keyword and the right particle.
 * fillKeyword('{k은} 끝이 없습니다', '쇼츠') -> '쇼츠는 끝이 없습니다'
 */
export function fillKeyword(template, keyword) {
  return template.replace(/\{k(은|이|을)?\}/g, (_, j) => (j ? keyword + (hasBatchim(keyword) ? JOSA[j][0] : JOSA[j][1]) : keyword));
}
