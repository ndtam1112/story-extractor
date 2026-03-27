import https from 'https';

https.get('https://vivutruyen2.net/sau-khi-chien-tranh-lanh-toi-tron-chay-voi-dua-con-trong-bung/chuong-1/', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
