import Rating from '@mui/material/Rating';
import StarIcon from '@mui/icons-material/Star';

interface RatingStarsProps {
  value: number;
  readOnly?: boolean;
  size?: 'small' | 'medium' | 'large';
  onChange?: (value: number) => void;
}

/** 星级评分展示 / 输入 */
export default function RatingStars({
  value,
  readOnly = true,
  size = 'small',
  onChange,
}: RatingStarsProps) {
  return (
    <Rating
      value={value}
      readOnly={readOnly}
      size={size}
      precision={1}
      emptyIcon={<StarIcon style={{ opacity: 0.3 }} fontSize="inherit" />}
      onChange={(_event, newValue) => {
        if (onChange && newValue !== null) {
          onChange(newValue);
        }
      }}
    />
  );
}
