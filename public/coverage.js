// Phan loai NGAY RONG. Day la cho duy nhat quyet dinh mot ngay khong co du lieu la
// "thieu that" hay "job chua keo toi". Sai o day thi dashboard hoac bao dong gia (do ca
// 70 ngay job chua di toi), hoac nuot mat lo that -- ca hai deu lam nguoi dung tin nham.
//
// Job chay theo chieu CU -> MOI va bo qua ngay da co raw. Khi khong co job, ngay sau raw
// moi nhat la CHUA KÉO, khong phai thieu that; chi gap nam truoc moc do moi la missing.
export function classify(calendar, { dang_keo = null, latest_day = null, running = null } = {}) {
  const unpulled = new Set(!running && latest_day
    ? calendar.filter(d => !d.rows && d.day > latest_day).map(d => d.day) : []);
  const pending = new Set(running && dang_keo
    ? calendar.filter(d => !d.rows && d.day > dang_keo).map(d => d.day) : []);
  return {
    has: calendar.filter(d => d.rows > 0),
    miss: calendar.filter(d => !d.rows && !pending.has(d.day) && !unpulled.has(d.day)),
    unpulled: calendar.filter(d => unpulled.has(d.day)),
    pending,
  };
}

// ETA tinh tu nhip do THUC TE 10 phut qua, khong phai hang so: ngay sale 40k dong cham
// gap 4 lan ngay thuong, mot hang so "1 phut/ngay" se sai ngay khi vao mua.
export function eta(daysLeft, days10m = 0, running = null) {
  const perMin = days10m / 10;
  if (!running || perMin <= 0 || !daysLeft) return '';
  const min = Math.round(daysLeft / perMin);
  return min >= 60 ? `còn ~${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
                   : `còn ~${min} phút`;
}
