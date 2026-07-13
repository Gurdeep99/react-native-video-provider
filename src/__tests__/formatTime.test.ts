import { formatTime } from '../utils/formatTime';

describe('formatTime', () => {
  it('formats seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('formats hours', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('handles junk', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-4)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });
});
